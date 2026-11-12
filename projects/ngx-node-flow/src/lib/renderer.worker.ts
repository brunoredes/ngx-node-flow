/// Runs inside a Worker: owns the canvases, camera and interaction state.
/// Bundled to a string by scripts/build-worker.mjs (see worker-source.ts).
import { align, bezier, Camera, distToPolyline, MINIMAP, nodeHeight, portPos, Side, toWorld, zoomAt } from './geometry';
import { GlRenderer, RECT_STRIDE, RGBA } from './gl';
import { cloneGraph, GraphStore, noChanges } from './store';
import { Command, FlowEdge, FlowNode, FromWorker, GraphChanges, GraphChunk, GraphSnapshot, NodeFlowConfig, ResolvedTheme, ToWorker } from './types';

const HEADER_TEXT_Y = 12;
const PAD = 10;
/** Offset of pasted / duplicated nodes from their originals (world px). */
const PASTE_OFFSET = 40;

let cfg: NodeFlowConfig;
let theme: ResolvedTheme;
let renderer: GlRenderer;
let text: OffscreenCanvasRenderingContext2D;
let glCanvas: OffscreenCanvas;
let mini: OffscreenCanvasRenderingContext2D;
let minimapOn = true;
let width = 1, height = 1, dpr = 1;
let cam: Camera = { x: 0, y: 0, zoom: 1 };
let store: GraphStore;
let readonly = false;
/** The consumer set a canConnect input: drops wait for its answer. */
let canConnect = false;
let pendingLink: { edge: FlowEdge; detached?: FlowEdge } | null = null;

// selection; selVersion bumps on every change so the id lists are only sent when they changed
let selNodes = new Set<string>();
let selEdges = new Set<string>();
let selVersion = 0;
/** Keyboard focus. Drawn (and announced) only after a keyboard command, not on clicks. */
let focused: string | null = null;
let focusVisible = false;

type Drag =
  | { kind: 'pan'; sx: number; sy: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  /** group: nodes that move with the pointer and where they started (empty when readonly or all locked). */
  | {
      kind: 'node';
      node: FlowNode;
      toggle: boolean;
      sx: number;
      sy: number;
      group: { id: string; x: number; y: number }[];
      moved: boolean;
      /** Active alignment guides (world x of the vertical line, y of the horizontal one). */
      guide?: { vx?: number; hy?: number };
    }
  | { kind: 'link'; node: FlowNode; side: Side; port: string; wx: number; wy: number; detached?: FlowEdge };
let drag: Drag | null = null;

let rects = new Float32Array(0);
let lines = new Float32Array(0);
/** Edges drawn in the last frame: what a click can hit. */
let drawnEdges: FlowEdge[] = [];
/** Nodes drawn in the last frame: what alignment guides snap to. */
let drawnNodes: FlowNode[] = [];

const send = (msg: FromWorker) => postMessage(msg);

const colorCache = new Map<string, RGBA>();
let swatch: OffscreenCanvasRenderingContext2D | undefined;
function rgba(css: string): RGBA {
  let c = colorCache.get(css);
  if (c) return c;
  // paint and read back: works for any CSS color space (oklch, color(), color-mix) without parsing
  swatch ??= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  swatch.clearRect(0, 0, 1, 1);
  swatch.fillStyle = '#000';
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
  c = [r / 255, g / 255, b / 255, a / 255];
  colorCache.set(css, c);
  return c;
}

const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], c[3] * a];

function portIndex(n: FlowNode, side: Side, id: string) {
  return ((side === 'in' ? n.inputs : n.outputs) ?? []).findIndex((p) => p.id === id);
}

/** The edge's curve as a polyline, or null if an endpoint is missing. */
function curve(e: FlowEdge, segments: number): number[] | null {
  const s = store.node(e.source), t = store.node(e.target);
  if (!s || !t) return null;
  const a = portPos(s, 'out', portIndex(s, 'out', e.sourcePort), cfg);
  const b = portPos(t, 'in', portIndex(t, 'in', e.targetPort), cfg);
  return bezier(a.x, a.y, b.x, b.y, segments);
}

let scheduled = false;
function schedule() {
  if (scheduled || !renderer) return;
  scheduled = true;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  raf(() => {
    scheduled = false;
    render();
  });
}

function pushRect(i: number, x: number, y: number, w: number, h: number, c: RGBA, r: number) {
  const o = i * RECT_STRIDE; // indexed writes: no per-rect array allocation
  rects[o] = x;
  rects[o + 1] = y;
  rects[o + 2] = w;
  rects[o + 3] = h;
  rects[o + 4] = c[0];
  rects[o + 5] = c[1];
  rects[o + 6] = c[2];
  rects[o + 7] = c[3];
  rects[o + 8] = r;
}

function pushCurve(i: number, pts: number[], halfWidth: number): number {
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const ax = pts[p], ay = pts[p + 1], bx = pts[p + 2], by = pts[p + 3];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * halfWidth, ny = ((bx - ax) / len) * halfWidth;
    // two triangles (a+ a- b+, b+ a- b-), written in place
    let o = i * 2;
    lines[o++] = ax + nx; lines[o++] = ay + ny;
    lines[o++] = ax - nx; lines[o++] = ay - ny;
    lines[o++] = bx + nx; lines[o++] = by + ny;
    lines[o++] = bx + nx; lines[o++] = by + ny;
    lines[o++] = ax - nx; lines[o++] = ay - ny;
    lines[o++] = bx - nx; lines[o] = by - ny;
    i += 6;
  }
  return i;
}

function render() {
  const c = cfg.node;
  const portColor = rgba(theme.portColor);
  const accent = rgba(theme.accent);
  // only what is (almost) on screen: margin covers ports and curve control points
  const tl = toWorld(cam, 0, 0), br = toWorld(cam, width, height);
  const m = c.width;
  const visible = store.query(tl.x - m, tl.y - m, br.x + m, br.y + m);
  const showPorts = cam.zoom >= 0.3;

  drawnNodes = visible;
  let rectCount = visible.length + 4; // + focus ring, selection rectangle, two guide lines
  if (showPorts) for (const n of visible) rectCount += (n.inputs?.length ?? 0) + (n.outputs?.length ?? 0);
  if (rects.length < rectCount * RECT_STRIDE) rects = new Float32Array(rectCount * RECT_STRIDE * 2);

  // while connecting, ports the dragged edge cannot land on are dimmed (cycles are only checked on drop)
  const link = drag?.kind === 'link' ? drag : null;
  const dimPort = withAlpha(portColor, 0.25);
  let ri = 0;
  for (const n of visible) {
    const h = nodeHeight(n, cfg);
    if (focusVisible && n.id === focused) {
      const g = 3 / cam.zoom; // ~3 screen px ring at any zoom
      pushRect(ri++, n.x - g, n.y - g, c.width + 2 * g, h + 2 * g, accent, c.radius + g);
    }
    const color = selNodes.has(n.id) ? rgba(theme.nodeSelectedColor) : rgba(n.color ?? theme.nodeColor);
    pushRect(ri++, n.x, n.y, c.width, h, color, c.radius);
    if (!showPorts) continue;
    for (const side of ['in', 'out'] as const) {
      const ports = (side === 'in' ? n.inputs : n.outputs) ?? [];
      for (let p = 0; p < ports.length; p++) {
        const pos = portPos(n, side, p, cfg);
        const r = c.portRadius;
        const ok = !link || (side !== link.side && n.id !== link.node.id && !store.check(toEdge(link, n, ports[p].id), false));
        pushRect(ri++, pos.x - r, pos.y - r, 2 * r, 2 * r, ok ? portColor : dimPort, r);
      }
    }
  }
  if (drag?.kind === 'node' && drag.guide) {
    const { vx, hy } = drag.guide, px = 1 / cam.zoom, guide = withAlpha(accent, 0.8);
    if (vx !== undefined) pushRect(ri++, vx - px / 2, tl.y, px, br.y - tl.y, guide, 0);
    if (hy !== undefined) pushRect(ri++, tl.x, hy - px / 2, br.x - tl.x, px, guide, 0);
  }
  if (drag?.kind === 'marquee') {
    const { x0, y0, x1, y1 } = drag;
    pushRect(ri++, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), withAlpha(accent, 0.2), 0);
  }

  // shortcut: edges with no visible endpoint are skipped even if they cross the viewport.
  const edges = store.edgesOf(visible);
  drawnEdges = edges;
  const SEG = cam.zoom >= 0.5 ? 24 : 8, VERTS_PER_CURVE = SEG * 6;
  const curveCount = edges.length + (link ? 1 : 0);
  if (lines.length < curveCount * VERTS_PER_CURVE * 2) lines = new Float32Array(curveCount * VERTS_PER_CURVE * 4);
  let li = 0;
  const hw = cfg.edge.width / 2;
  // selected edges go last, so they draw on top in the accent color
  const picked: FlowEdge[] = [];
  for (const e of edges) {
    if (selEdges.has(e.id)) picked.push(e);
    else {
      const pts = curve(e, SEG);
      if (pts) li = pushCurve(li, pts, hw);
    }
  }
  const accentFrom = li;
  for (const e of picked) {
    const pts = curve(e, SEG);
    if (pts) li = pushCurve(li, pts, hw * 1.5);
  }
  if (link) {
    const p = portPos(link.node, link.side, portIndex(link.node, link.side, link.port), cfg);
    const [a, b] = link.side === 'out' ? [p, { x: link.wx, y: link.wy }] : [{ x: link.wx, y: link.wy }, p];
    li = pushCurve(li, bezier(a.x, a.y, b.x, b.y, SEG), hw);
  }

  renderer.draw({
    width, height, dpr, cam,
    background: rgba(theme.background),
    grid: cfg.grid.visible ? { size: cfg.grid.size, color: rgba(theme.gridColor) } : null,
    rects, rectCount: ri,
    lines, lineCount: li,
    lineColor: rgba(theme.edgeColor),
    accentFrom, accentColor: accent,
  });
  drawText(visible);
  if (minimapOn) drawMinimap(tl, br);
  reportSelection();
  reportFocus();
  reportStats();
}

// --- minimap: a density image of the whole graph (redrawn at most every MINI_MS), plus the viewport box
const MINI_MS = 250;
let miniImage: ImageData | null = null;
let miniRev = -1, miniAt = 0;
/** world -> minimap px: px = (world - x0) * s + o */
let miniMap = { x0: 0, y0: 0, s: 1, ox: 0, oy: 0 };

function drawMinimap(tl: { x: number; y: number }, br: { x: number; y: number }) {
  const W = mini.canvas.width, H = mini.canvas.height;
  if (store.revision !== miniRev) {
    const wait = miniAt + MINI_MS - performance.now();
    if (wait > 0) setTimeout(schedule, wait); // throttled: one more frame once the window passes
    else {
      miniRev = store.revision;
      miniAt = performance.now();
      miniImage = rasterize(W, H);
    }
  }
  mini.fillStyle = theme.surface;
  mini.fillRect(0, 0, W, H);
  if (miniImage) mini.putImageData(miniImage, 0, 0);
  const { x0, y0, s, ox, oy } = miniMap;
  mini.strokeStyle = theme.accent;
  mini.lineWidth = dpr;
  mini.strokeRect((tl.x - x0) * s + ox, (tl.y - y0) * s + oy, (br.x - tl.x) * s, (br.y - tl.y) * s);
}

/** One pixel per occupied cell, more opaque where nodes pile up. */
function rasterize(W: number, H: number): ImageData | null {
  const b = store.bounds();
  if (!b) return null;
  const pad = 4 * dpr, bw = b.x1 - b.x0 || 1, bh = b.y1 - b.y0 || 1;
  const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  miniMap = { x0: b.x0, y0: b.y0, s, ox: (W - bw * s) / 2, oy: (H - bh * s) / 2 };
  const counts = new Uint16Array(W * H);
  const { ox, oy } = miniMap;
  store.eachPosition((x, y) => {
    const px = Math.floor((x - b.x0) * s + ox), py = Math.floor((y - b.y0) * s + oy);
    const i = py * W + px;
    if (px >= 0 && py >= 0 && px < W && py < H && counts[i] < 65535) counts[i]++;
  });
  const img = new ImageData(W, H);
  const [r, g, bl] = rgba(theme.text);
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue;
    img.data[i * 4] = r * 255;
    img.data[i * 4 + 1] = g * 255;
    img.data[i * 4 + 2] = bl * 255;
    img.data[i * 4 + 3] = Math.min(255, 110 + counts[i] * 30);
  }
  return img;
}

/** Centers the view on the world point under a minimap position (CSS px). */
function minimapTo(x: number, y: number) {
  const { x0, y0, s, ox, oy } = miniMap;
  const wx = (x * dpr - ox) / s + x0, wy = (y * dpr - oy) / s + y0;
  cam = { zoom: cam.zoom, x: width / 2 - wx * cam.zoom, y: height / 2 - wy * cam.zoom };
}

function drawText(visible: FlowNode[]) {
  text.setTransform(1, 0, 0, 1, 0, 0);
  text.clearRect(0, 0, text.canvas.width, text.canvas.height);
  if (cam.zoom < 0.35) return; // unreadable anyway; skip the cost
  text.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x, dpr * cam.y);
  text.font = `${cfg.node.fontSize}px ${theme.fontFamily || 'sans-serif'}`;
  text.fillStyle = theme.nodeTextColor;
  text.textBaseline = 'middle';
  const w = cfg.node.width;
  // shortcut: text lives on a layer above all GL shapes, so overlapping nodes show each other's labels.
  for (const n of visible) {
    text.textAlign = 'left';
    text.fillText(n.label, n.x + PAD, n.y + HEADER_TEXT_Y, w - 2 * PAD);
    n.inputs?.forEach((p, i) => text.fillText(p.label ?? p.id, n.x + PAD, portPos(n, 'in', i, cfg).y, w / 2 - PAD));
    text.textAlign = 'right';
    n.outputs?.forEach((p, i) => text.fillText(p.label ?? p.id, n.x + w - PAD, portPos(n, 'out', i, cfg).y, w / 2 - PAD));
  }
}

// --- selection -------------------------------------------------------------------

function selectOnly(nodes: Iterable<string>, edges: Iterable<string> = []) {
  selNodes = new Set(nodes);
  selEdges = new Set(edges);
  selVersion++;
}

function toggleIn(set: Set<string>, id: string) {
  if (!set.delete(id)) set.add(id);
  selVersion++;
}

/** Drops removed ids from the selection and focus. */
function prune(ch: GraphChanges) {
  for (const id of ch.removeNodes) if (selNodes.delete(id)) selVersion++;
  for (const id of ch.removeEdges) if (selEdges.delete(id)) selVersion++;
  if (focused && ch.removeNodes.includes(focused)) focused = null;
}

/** Closest drawn edge within a few screen px of the world point. */
function edgeAt(wx: number, wy: number): FlowEdge | null {
  let best: FlowEdge | null = null, bestDist = Math.max(cfg.edge.width, 6 / cam.zoom);
  for (const e of drawnEdges) {
    const pts = curve(e, 24);
    const d = pts ? distToPolyline(pts, wx, wy) : Infinity;
    if (d < bestDist) [best, bestDist] = [e, d];
  }
  return best;
}

// --- pointer -----------------------------------------------------------------------

function onPointer(kind: 'down' | 'move' | 'up' | 'cancel', sx: number, sy: number, toggle = false) {
  const w = toWorld(cam, sx, sy);
  if (kind === 'cancel') {
    if (drag?.kind === 'link' && drag.detached) store.connect(drag.detached); // put the picked-up edge back
    if (drag?.kind === 'node') endNodeDrag(drag);
    drag = null;
  } else if (kind === 'down') {
    focusVisible = false; // the ring is for keyboard users; clicks still move the focus below
    const hit = store.hit(w.x, w.y);
    const port = readonly ? undefined : hit?.port;
    // grabbing a connected input picks up its edge (last one) so it can be reconnected or dropped
    const existing = port?.side === 'in' ? store.edgeInto(hit!.node.id, port.id) : undefined;
    const source = existing && store.node(existing.source);
    if (existing && source) {
      store.disconnect(existing.id);
      drag = { kind: 'link', node: source, side: 'out', port: existing.sourcePort, wx: w.x, wy: w.y, detached: existing };
    } else if (hit && port) {
      drag = { kind: 'link', node: hit.node, side: port.side, port: port.id, wx: w.x, wy: w.y };
    } else if (hit) {
      const id = hit.node.id;
      focused = id;
      // bring to front so it draws (and hit-tests) on top
      store.bringToFront(id);
      if (!toggle && !selNodes.has(id)) selectOnly([id]);
      // shortcut: dragging a huge selection (Ctrl+A on 1M nodes) moves every node every frame.
      const ids = selNodes.has(id) ? selNodes : [id];
      const group = readonly ? [] : [...ids].flatMap((i) => {
        const n = store.node(i);
        return n && !n.locked ? [{ id: i, x: n.x, y: n.y }] : [];
      });
      drag = { kind: 'node', node: hit.node, toggle, sx: w.x, sy: w.y, group, moved: false };
      if (group.length) store.begin(); // the whole gesture is one undo step
    } else {
      const edge = edgeAt(w.x, w.y);
      if (edge) {
        if (toggle) toggleIn(selEdges, edge.id);
        else selectOnly([], [edge.id]);
        drag = { kind: 'pan', sx, sy };
      } else if (toggle) {
        drag = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      } else {
        if (selNodes.size || selEdges.size) selectOnly([]);
        drag = { kind: 'pan', sx, sy };
      }
    }
  } else if (kind === 'move' && drag) {
    if (drag.kind === 'pan') {
      cam = { ...cam, x: cam.x + sx - drag.sx, y: cam.y + sy - drag.sy };
      drag.sx = sx;
      drag.sy = sy;
    } else if (drag.kind === 'marquee') {
      drag.x1 = w.x;
      drag.y1 = w.y;
    } else if (drag.kind === 'node') {
      if (!drag.group.length) return;
      const { dx, dy } = placeGroup(drag, w.x - drag.sx, w.y - drag.sy);
      for (const g of drag.group) store.move(g.id, g.x + dx, g.y + dy);
      drag.moved = true;
    } else {
      drag.wx = w.x;
      drag.wy = w.y;
    }
  } else if (kind === 'up' && drag) {
    if (drag.kind === 'node') {
      if (!endNodeDrag(drag)) {
        // a click: toggle keys add/remove, a plain click narrows the selection to this node
        if (drag.toggle) toggleIn(selNodes, drag.node.id);
        else if (selNodes.size !== 1 || selEdges.size) selectOnly([drag.node.id]);
        send({ type: 'nodeClick', id: drag.node.id });
      }
    } else if (drag.kind === 'marquee') {
      const { x0, y0, x1, y1 } = drag;
      for (const n of store.query(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))) selNodes.add(n.id);
      selVersion++;
    } else if (drag.kind === 'link') {
      const hit = store.hit(w.x, w.y);
      const edge = hit?.port && hit.port.side !== drag.side && hit.node.id !== drag.node.id ? toEdge(drag, hit.node, hit.port.id) : null;
      const { detached } = drag;
      if (detached && edge && sameEdge(detached, edge)) {
        store.connect(detached); // dropped back where it was
      } else if (edge) {
        tryLink(edge, detached);
      } else {
        link(null, detached);
      }
    }
    drag = null;
  } else {
    return; // hover move with no drag: nothing changed
  }
  schedule();
}

/**
 * Where a dragged group goes for a raw pointer offset: the dragged node snaps to the grid (grid.snap),
 * then to edges/centers of the other nodes on screen (grid.guides), and the rest of the group follows.
 */
function placeGroup(d: Extract<Drag, { kind: 'node' }>, dx: number, dy: number): { dx: number; dy: number } {
  const a = d.group.find((g) => g.id === d.node.id) ?? d.group[0];
  let x = a.x + dx, y = a.y + dy;
  const step = cfg.grid.size;
  if (cfg.grid.snap) [x, y] = [Math.round(x / step) * step, Math.round(y / step) * step];
  d.guide = undefined;
  if (cfg.grid.guides) {
    const moving = new Set(d.group.map((g) => g.id));
    const others = drawnNodes.filter((n) => !moving.has(n.id)).map((n) => ({ x: n.x, y: n.y, w: cfg.node.width, h: nodeHeight(n, cfg) }));
    const g = align({ x, y, w: cfg.node.width, h: nodeHeight(d.node, cfg) }, others, 6 / cam.zoom);
    [x, y] = [x + g.dx, y + g.dy];
    if (g.vx !== undefined || g.hy !== undefined) d.guide = { vx: g.vx, hy: g.hy };
  }
  return { dx: x - a.x, dy: y - a.y };
}

/** Applies the rules to a new edge, then either commits it or (with canConnect) asks the main thread first. */
function tryLink(edge: FlowEdge, detached?: FlowEdge) {
  if (reject(edge, detached)) return;
  if (!canConnect) return link(edge, detached);
  // the picked-up edge stays out of the store until the main thread answers (resolveConnect)
  if (pendingLink?.detached) store.connect(pendingLink.detached); // a newer drop supersedes an unanswered one
  pendingLink = { edge, detached };
  send({ type: 'connectRequest', edge });
}

/**
 * Refuses `edge` if a declarative rule forbids it, restoring the edge it was meant to replace.
 * Checked while a picked-up edge is still out of the store, since the new edge replaces it.
 */
function reject(edge: FlowEdge, detached: FlowEdge | undefined, reason = store.check(edge)): boolean {
  if (!reason) return false;
  send({ type: 'edgeRejected', edge, reason });
  if (detached) store.connect(detached);
  return true;
}

/** Reports where dragged nodes ended up and closes the undo step; false if nothing moved. */
function endNodeDrag(d: Extract<Drag, { kind: 'node' }>): boolean {
  if (!d.group.length) return false;
  const moved = d.moved ? d.group.flatMap((g) => store.node(g.id) ?? []) : [];
  if (moved.length) changed({ ...noChanges(), upsertNodes: moved });
  commit();
  return moved.length > 0;
}

/** Commits a connection gesture: drops the picked-up edge (if any) and adds the new one (if any). */
function link(edge: FlowEdge | null, detached: FlowEdge | undefined) {
  if (detached) store.connect(detached); // back in first, so the undo step records its removal
  store.begin();
  if (detached) store.disconnect(detached.id);
  const ch = noChanges();
  if (detached) ch.removeEdges.push(detached.id);
  const added = edge && store.connect(edge);
  if (added) ch.upsertEdges.push(...added.upsertEdges);
  if (detached || added) changed(ch);
  if (added) send({ type: 'edgeCreated', edge: edge! });
  commit();
}

// --- undo/redo: each entry is one user action, as the changes that undo and redo it

const HISTORY_LIMIT = 100;
type Step = { undo: GraphChanges; redo: GraphChanges };
let undoStack: Step[] = [], redoStack: Step[] = [];

/**
 * Closes the open store transaction and, if it changed anything, pushes it as an undo step.
 * report: also emit what changed as graphChange (for operations that did not report as they went).
 */
function commit(report = false) {
  const step = store.end();
  if (!step) return;
  undoStack.push(step);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  reportHistory();
  if (report) changed(step.redo);
}

/** Runs a mutation as one undo step. */
function record(fn: () => void) {
  store.begin();
  try {
    fn();
  } finally {
    commit();
  }
}

function travel(from: Step[], to: Step[], dir: keyof Step) {
  if (readonly || drag) return; // a drag holds an open transaction: finish the gesture first
  const step = from.pop();
  if (!step) return;
  store.begin();
  store.apply(step[dir]);
  const done = store.end();
  to.push(step);
  if (done) changed(done.redo); // what actually changed, so graphChange stays exact
  reportHistory();
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
  reportHistory();
}

const reportHistory = () => send({ type: 'history', undo: undoStack.length, redo: redoStack.length });

/** The main thread's answer to a connectRequest (the canConnect input). */
function resolveConnect(ok: boolean) {
  const p = pendingLink;
  pendingLink = null;
  if (!p) return;
  // the graph may have changed while waiting: rules are checked again
  if (!reject(p.edge, p.detached, ok ? store.check(p.edge) : 'custom')) link(p.edge, p.detached);
  schedule();
}

const sameEdge = (a: FlowEdge, b: FlowEdge) =>
  a.source === b.source && a.sourcePort === b.sourcePort && a.target === b.target && a.targetPort === b.targetPort;

// --- keyboard commands ----------------------------------------------------------------

const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;
const centerOf = (n: FlowNode) => ({ x: n.x + cfg.node.width / 2, y: n.y + nodeHeight(n, cfg) / 2 });

/** Nearest node in a direction (scored by distance along it plus twice the sideways offset). */
function focusNext(dir: keyof typeof DIRS, keep: boolean): string | null {
  const cur = focused ? store.node(focused) : undefined;
  let best: FlowNode | undefined;
  if (!cur) {
    // first focus: the node nearest the viewport center; else any node at all
    const c = toWorld(cam, width / 2, height / 2), tl = toWorld(cam, 0, 0), br = toWorld(cam, width, height);
    let bestDist = Infinity;
    for (const n of store.query(tl.x, tl.y, br.x, br.y)) {
      const p = centerOf(n), d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestDist) [best, bestDist] = [n, d];
    }
    best ??= store.node(store.ids()[0] ?? '');
  } else {
    const c = centerOf(cur), [ux, uy] = DIRS[dir];
    for (const r of [1500, 15000]) {
      let bestScore = Infinity;
      for (const n of store.query(c.x - r, c.y - r, c.x + r, c.y + r)) {
        const p = centerOf(n), dx = p.x - c.x, dy = p.y - c.y;
        const along = dx * ux + dy * uy;
        if (n.id === cur.id || along <= 1) continue;
        const score = along + 2 * Math.abs(dx * uy - dy * ux);
        if (score < bestScore) [best, bestScore] = [n, score];
      }
      if (best) break;
    }
  }
  focusVisible = true;
  if (best) {
    focused = best.id;
    if (!keep) selectOnly([best.id]);
    reveal(best);
  }
  schedule();
  return focused;
}

/** Pans to the node if it is not fully on screen. */
function reveal(n: FlowNode) {
  const sx = n.x * cam.zoom + cam.x, sy = n.y * cam.zoom + cam.y;
  const inside = sx >= 0 && sy >= 0 && sx + cfg.node.width * cam.zoom <= width && sy + nodeHeight(n, cfg) * cam.zoom <= height;
  if (inside) return;
  const c = centerOf(n);
  cam = { zoom: cam.zoom, x: width / 2 - c.x * cam.zoom, y: height / 2 - c.y * cam.zoom };
}

function moveSelection(dx: number, dy: number) {
  store.begin();
  for (const id of selNodes) {
    const n = store.node(id);
    if (n && !n.locked) store.move(id, n.x + dx, n.y + dy);
  }
  commit(true);
}

function removeMany(nodes: string[], edges: string[]) {
  store.begin();
  edges.forEach((id) => store.disconnect(id));
  for (const id of nodes) if (!store.node(id)?.locked) store.remove(id);
  commit(true);
}

/** Adds a copy of `g` (new ids, shifted) as one undo step and selects it. */
function paste(g: GraphSnapshot) {
  const copy = cloneGraph(g, PASTE_OFFSET, PASTE_OFFSET);
  store.begin();
  store.apply({ ...noChanges(), upsertNodes: copy.nodes, upsertEdges: copy.edges });
  commit(true);
  selectOnly(copy.nodes.map((n) => n.id));
  schedule();
}

/** Connects the first output of `from` and input of `to` the rules allow (going through canConnect if set). */
function connectNodes(from: string, to: string): boolean {
  const a = store.node(from), b = store.node(to);
  if (!a || !b || from === to) return false;
  for (const o of a.outputs ?? []) {
    for (const i of b.inputs ?? []) {
      const edge: FlowEdge = { id: `${from}:${o.id}->${to}:${i.id}`, source: from, sourcePort: o.id, target: to, targetPort: i.id };
      const taken = store.edgesOf([a]).some((e) => sameEdge(e, edge));
      if (taken || store.check(edge)) continue;
      tryLink(edge);
      schedule();
      return true;
    }
  }
  return false;
}

// --- reports to the main thread ---------------------------------------------------------

let sentSelVersion = -1;
let lastMenu = '';
/** Sends the selected ids when they change, and the menu anchor (single selected node) when it moves. */
function reportSelection() {
  if (sentSelVersion !== selVersion) {
    sentSelVersion = selVersion;
    send({ type: 'selected', nodes: [...selNodes], edges: [...selEdges] });
  }
  const only = selNodes.size === 1 && !selEdges.size ? selNodes.values().next().value : undefined;
  const n = only ? store.node(only) : undefined;
  const msg: FromWorker = n
    ? { type: 'selection', id: n.id, x: n.x * cam.zoom + cam.x, y: n.y * cam.zoom + cam.y, w: cfg.node.width * cam.zoom, h: nodeHeight(n, cfg) * cam.zoom, locked: !!n.locked }
    : { type: 'selection', id: null, x: 0, y: 0, w: 0, h: 0, locked: false };
  const key = JSON.stringify(msg);
  if (key !== lastMenu) {
    lastMenu = key;
    send(msg);
  }
}

let lastFocus = '';
function reportFocus() {
  const n = focusVisible && focused ? store.node(focused) : undefined;
  const msg: FromWorker = { type: 'focus', id: n?.id ?? null, label: n?.label ?? '', selected: !!n && selNodes.has(n.id) };
  const key = JSON.stringify(msg);
  if (key !== lastFocus) {
    lastFocus = key;
    send(msg);
  }
}

let lastStats = '';
function reportStats() {
  const key = `${store.nodeCount},${store.edgeCount}`;
  if (key === lastStats) return;
  lastStats = key;
  send({ type: 'stats', nodes: store.nodeCount, edges: store.edgeCount });
}

function changed(changes: GraphChanges) {
  prune(changes);
  if (!store.nodeCount) cam = { x: 0, y: 0, zoom: 1 };
  send({ type: 'changes', changes });
  schedule();
}

/** Commands that change the graph; refused in readonly mode. */
const EDITS = new Set<Command['op']>(['addAfter', 'remove', 'upsertNode', 'moveSelection', 'removeMany', 'paste', 'duplicate', 'connectNodes']);

function run(command: Command): unknown {
  if (readonly && EDITS.has(command.op)) return;
  switch (command.op) {
    case 'getNode':
      return store.node(command.id);
    case 'addAfter':
      return record(() => changed(store.addAfter(command.id, command.node)));
    case 'remove':
      return record(() => changed(store.remove(command.id)));
    case 'upsertNode':
      return record(() => changed(store.upsertNode(command.node)));
    case 'undo':
      return travel(undoStack, redoStack, 'undo');
    case 'redo':
      return travel(redoStack, undoStack, 'redo');
    case 'chunk':
      store.addChunk(command.chunk);
      schedule();
      return;
    case 'snapshot':
      return store.snapshot();
    case 'find':
      return store.find(command.text, command.limit);
    case 'fit': {
      const b = store.bounds();
      if (b) frame(b.x0, b.y0, b.x1, b.y1, command.padding);
      return;
    }
    case 'center': {
      const n = store.node(command.id);
      if (!n) throw new Error(`ngx-node-flow: no node ${command.id}`);
      const c = centerOf(n);
      setCam({ zoom: cam.zoom, x: width / 2 - c.x * cam.zoom, y: height / 2 - c.y * cam.zoom });
      return;
    }
    case 'zoom':
      setCam(zoomAt(cam, width / 2, height / 2, command.zoom / cam.zoom, cfg.zoom.min, cfg.zoom.max));
      return;
    case 'resolveConnect':
      return resolveConnect(command.ok);
    case 'select':
      selectOnly(command.ids.filter((id) => store.node(id)));
      return schedule();
    case 'selectAll':
      selectOnly(store.ids());
      return schedule();
    case 'focusNext':
      return focusNext(command.dir, command.keep);
    case 'toggleFocused':
      if (focused) toggleIn(selNodes, focused);
      return schedule();
    case 'moveSelection':
      return moveSelection(command.dx, command.dy);
    case 'removeMany':
      return removeMany(command.nodes, command.edges);
    case 'copy':
      return store.subgraph(selNodes);
    case 'paste':
      return paste(command.graph);
    case 'duplicate':
      return paste(store.subgraph(selNodes));
    case 'connectNodes':
      return connectNodes(command.from, command.to);
  }
}

function setCam(c: Camera) {
  cam = c;
  schedule();
}

/** Fits the world rect into the viewport, `padding` CSS px on each side, zoom clamped to config. */
function frame(x0: number, y0: number, x1: number, y1: number, padding: number) {
  const fit = Math.min((width - 2 * padding) / (x1 - x0), (height - 2 * padding) / (y1 - y0));
  const zoom = Math.min(cfg.zoom.max, Math.max(cfg.zoom.min, fit));
  setCam({ zoom, x: width / 2 - ((x0 + x1) / 2) * zoom, y: height / 2 - ((y0 + y1) / 2) * zoom });
}

/** Streamed chunks land through a WritableStream, so a slow worker back-pressures the producer. */
function ingest(stream: ReadableStream<GraphChunk>): Promise<void> {
  return stream.pipeTo(
    new WritableStream<GraphChunk>(
      {
        write(chunk) {
          store.addChunk(chunk);
          schedule();
        },
      },
      new CountQueuingStrategy({ highWaterMark: 4 }),
    ),
  );
}

const reply = (reqId: number, value?: unknown) => send({ type: 'reply', reqId, value });
const fail = (reqId: number, err: unknown) => send({ type: 'reply', reqId, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });

function toEdge(d: Extract<Drag, { kind: 'link' }>, other: FlowNode, otherPort: string): FlowEdge {
  const [s, sp, t, tp] = d.side === 'out' ? [d.node, d.port, other, otherPort] : [other, otherPort, d.node, d.port];
  return { id: `${s.id}:${sp}->${t.id}:${tp}`, source: s.id, sourcePort: sp, target: t.id, targetPort: tp };
}

addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type !== 'init' && !renderer) {
    // init failed (already reported): reject requests instead of leaving them pending
    if ('reqId' in m) fail(m.reqId, new Error('ngx-node-flow: renderer not available'));
    return;
  }
  switch (m.type) {
    case 'init': {
      cfg = m.config;
      theme = m.theme;
      glCanvas = m.gl;
      const gl = m.gl.getContext('webgl2', { antialias: true, premultipliedAlpha: true });
      if (!gl) return send({ type: 'error', message: 'ngx-node-flow: WebGL2 not available' });
      store = new GraphStore(cfg);
      text = m.text.getContext('2d')!;
      mini = m.mini.getContext('2d')!;
      // GPU reset: the graph survives in the store; GL objects are rebuilt when the context returns
      glCanvas.addEventListener('webglcontextlost', (ev) => ev.preventDefault());
      glCanvas.addEventListener('webglcontextrestored', () => {
        renderer = new GlRenderer(gl);
        schedule();
      });
      renderer = new GlRenderer(gl);
      break;
    }
    case 'resize':
      ({ width, height, dpr } = m);
      for (const c of [glCanvas, text.canvas]) {
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      mini.canvas.width = Math.round(MINIMAP.w * dpr);
      mini.canvas.height = Math.round(MINIMAP.h * dpr);
      miniRev = -1; // new pixel size: rasterize again
      break;
    case 'data':
      store.reset(m.nodes, m.edges);
      drag = null; // dragged objects were replaced
      pendingLink = null;
      clearHistory();
      miniRev = -1;
      selectOnly([...selNodes].filter((id) => store.node(id)), [...selEdges].filter((id) => store.hasEdge(id)));
      if (focused && !store.node(focused)) focused = null;
      if (!store.nodeCount) cam = { x: 0, y: 0, zoom: 1 };
      break;
    case 'command':
      try {
        reply(m.reqId, run(m.command));
      } catch (err) {
        fail(m.reqId, err);
      }
      return;
    case 'stream':
      ingest(m.stream).then(() => reply(m.reqId), (err) => fail(m.reqId, err));
      return;
    case 'mode':
      ({ readonly, canConnect, minimap: minimapOn } = m);
      if (readonly && drag?.kind === 'link') onPointer('cancel', 0, 0);
      break;
    case 'theme':
      theme = m.theme;
      colorCache.clear();
      break;
    case 'pointer':
      return onPointer(m.kind, m.x, m.y, m.toggle);
    case 'minimap':
      minimapTo(m.x, m.y);
      break;
    case 'view':
      cam = zoomAt({ ...cam, x: cam.x + m.panX, y: cam.y + m.panY }, m.x, m.y, m.zoom, cfg.zoom.min, cfg.zoom.max);
      break;
  }
  schedule();
});

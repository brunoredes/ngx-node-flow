/// Runs inside a Worker: owns the canvases, camera and interaction state.
/// Bundled to a string by scripts/build-worker.mjs (see worker-source.ts).
import { bezier, Camera, nodeHeight, portPos, Side, toWorld, zoomAt } from './geometry';
import { GlRenderer, RECT_STRIDE, RGBA } from './gl';
import { GraphStore } from './store';
import { Command, FlowEdge, FlowNode, FromWorker, GraphChanges, GraphChunk, NodeFlowConfig, ResolvedTheme, ToWorker } from './types';

const HEADER_TEXT_Y = 12;
const PAD = 10;

let cfg: NodeFlowConfig;
let theme: ResolvedTheme;
let renderer: GlRenderer;
let text: OffscreenCanvasRenderingContext2D;
let glCanvas: OffscreenCanvas;
let width = 1, height = 1, dpr = 1;
let cam: Camera = { x: 0, y: 0, zoom: 1 };
let store: GraphStore;
let selected: string | null = null;

type Drag =
  | { kind: 'pan'; sx: number; sy: number }
  | { kind: 'node'; node: FlowNode; dx: number; dy: number; moved: boolean }
  | { kind: 'link'; node: FlowNode; side: Side; port: string; wx: number; wy: number; detached?: FlowEdge };
let drag: Drag | null = null;

let rects = new Float32Array(0);
let lines = new Float32Array(0);

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

function portIndex(n: FlowNode, side: Side, name: string) {
  return ((side === 'in' ? n.inputs : n.outputs) ?? []).indexOf(name);
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
  // only what is (almost) on screen: margin covers ports and curve control points
  const tl = toWorld(cam, 0, 0), br = toWorld(cam, width, height);
  const m = c.width;
  const visible = store.query(tl.x - m, tl.y - m, br.x + m, br.y + m);
  const showPorts = cam.zoom >= 0.3;

  let rectCount = visible.length;
  if (showPorts) for (const n of visible) rectCount += (n.inputs?.length ?? 0) + (n.outputs?.length ?? 0);
  if (rects.length < rectCount * RECT_STRIDE) rects = new Float32Array(rectCount * RECT_STRIDE * 2);

  let ri = 0;
  for (const n of visible) {
    const color = n.id === selected ? rgba(theme.nodeSelectedColor) : rgba(n.color ?? theme.nodeColor);
    pushRect(ri++, n.x, n.y, c.width, nodeHeight(n, cfg), color, c.radius);
    if (!showPorts) continue;
    for (const side of ['in', 'out'] as const) {
      const names = (side === 'in' ? n.inputs : n.outputs) ?? [];
      for (let p = 0; p < names.length; p++) {
        const pos = portPos(n, side, p, cfg);
        const r = c.portRadius;
        pushRect(ri++, pos.x - r, pos.y - r, 2 * r, 2 * r, portColor, r);
      }
    }
  }

  // shortcut: edges with no visible endpoint are skipped even if they cross the viewport.
  const edges = store.edgesOf(visible);
  const SEG = cam.zoom >= 0.5 ? 24 : 8, VERTS_PER_CURVE = SEG * 6;
  const curveCount = edges.length + (drag?.kind === 'link' ? 1 : 0);
  if (lines.length < curveCount * VERTS_PER_CURVE * 2) lines = new Float32Array(curveCount * VERTS_PER_CURVE * 4);
  let li = 0;
  const hw = cfg.edge.width / 2;
  for (const e of edges) {
    const s = store.node(e.source), t = store.node(e.target);
    if (!s || !t) continue;
    const a = portPos(s, 'out', portIndex(s, 'out', e.sourcePort), cfg);
    const b = portPos(t, 'in', portIndex(t, 'in', e.targetPort), cfg);
    li = pushCurve(li, bezier(a.x, a.y, b.x, b.y, SEG), hw);
  }
  if (drag?.kind === 'link') {
    const p = portPos(drag.node, drag.side, portIndex(drag.node, drag.side, drag.port), cfg);
    const [a, b] = drag.side === 'out' ? [p, { x: drag.wx, y: drag.wy }] : [{ x: drag.wx, y: drag.wy }, p];
    li = pushCurve(li, bezier(a.x, a.y, b.x, b.y, SEG), hw);
  }

  renderer.draw({
    width, height, dpr, cam,
    background: rgba(theme.background),
    grid: cfg.grid.visible ? { size: cfg.grid.size, color: rgba(theme.gridColor) } : null,
    rects, rectCount: ri,
    lines, lineCount: li,
    lineColor: rgba(theme.edgeColor),
  });
  drawText(visible);
  reportSelection();
  reportStats();
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
    n.inputs?.forEach((name, i) => text.fillText(name, n.x + PAD, portPos(n, 'in', i, cfg).y, w / 2 - PAD));
    text.textAlign = 'right';
    n.outputs?.forEach((name, i) => text.fillText(name, n.x + w - PAD, portPos(n, 'out', i, cfg).y, w / 2 - PAD));
  }
}

function onPointer(kind: 'down' | 'move' | 'up' | 'cancel', sx: number, sy: number) {
  const w = toWorld(cam, sx, sy);
  if (kind === 'cancel') {
    if (drag?.kind === 'link' && drag.detached) store.connect(drag.detached); // put the picked-up edge back
    drag = null;
  } else if (kind === 'down') {
    const hit = store.hit(w.x, w.y);
    const port = hit?.port;
    // grabbing a connected input picks up its edge (last one) so it can be reconnected or dropped
    const existing = port?.side === 'in' ? store.edgeInto(hit!.node.id, port.name) : undefined;
    const source = existing && store.node(existing.source);
    if (existing && source) {
      store.disconnect(existing.id);
      drag = { kind: 'link', node: source, side: 'out', port: existing.sourcePort, wx: w.x, wy: w.y, detached: existing };
    } else if (hit && port) {
      drag = { kind: 'link', node: hit.node, side: port.side, port: port.name, wx: w.x, wy: w.y };
    } else if (hit) {
      // bring to front so it draws (and hit-tests) on top
      store.bringToFront(hit.node.id);
      drag = { kind: 'node', node: hit.node, dx: w.x - hit.node.x, dy: w.y - hit.node.y, moved: false };
    } else {
      selected = null;
      drag = { kind: 'pan', sx, sy };
    }
  } else if (kind === 'move' && drag) {
    if (drag.kind === 'pan') {
      cam = { ...cam, x: cam.x + sx - drag.sx, y: cam.y + sy - drag.sy };
      drag.sx = sx;
      drag.sy = sy;
    } else if (drag.kind === 'node') {
      store.move(drag.node.id, w.x - drag.dx, w.y - drag.dy);
      drag.moved = true;
    } else {
      drag.wx = w.x;
      drag.wy = w.y;
    }
  } else if (kind === 'up' && drag) {
    if (drag.kind === 'node') {
      selected = drag.node.id;
      // drag.node is the snapshot from pointerdown; report where the node ended up
      const moved = drag.moved && store.node(drag.node.id);
      if (moved) changed({ upsertNodes: [moved], removeNodes: [], upsertEdges: [], removeEdges: [] });
      else send({ type: 'nodeClick', id: drag.node.id });
    } else if (drag.kind === 'link') {
      const hit = store.hit(w.x, w.y);
      const edge = hit?.port && hit.port.side !== drag.side && hit.node.id !== drag.node.id ? toEdge(drag, hit.node, hit.port.name) : null;
      // checked while a picked-up edge is still out of the store, since the new edge replaces it
      const cyclic = !!edge && !cfg.edge.allowCycles && store.reaches(edge.target, edge.source);
      if (cyclic) send({ type: 'edgeRejected', edge: edge!, reason: 'cycle' });
      if (drag.detached && edge && (cyclic || sameEdge(drag.detached, edge))) {
        store.connect(drag.detached); // refused or dropped back where it was: restore
      } else if (!cyclic) {
        if (drag.detached) changed({ upsertNodes: [], removeNodes: [], upsertEdges: [], removeEdges: [drag.detached.id] });
        const added = edge && store.connect(edge);
        if (added) {
          changed(added);
          send({ type: 'edgeCreated', edge: edge! });
        }
      }
    }
    drag = null;
  } else {
    return; // hover move with no drag: nothing changed
  }
  schedule();
}

const sameEdge = (a: FlowEdge, b: FlowEdge) =>
  a.source === b.source && a.sourcePort === b.sourcePort && a.target === b.target && a.targetPort === b.targetPort;

let lastSelection = '';
/** Sends the selected node's screen rect whenever it changes, so the DOM menu can follow it. */
function reportSelection() {
  const n = selected ? store.node(selected) : undefined;
  const msg: FromWorker = n
    ? { type: 'selection', id: n.id, x: n.x * cam.zoom + cam.x, y: n.y * cam.zoom + cam.y, w: cfg.node.width * cam.zoom, h: nodeHeight(n, cfg) * cam.zoom }
    : { type: 'selection', id: null, x: 0, y: 0, w: 0, h: 0 };
  const key = JSON.stringify(msg);
  if (key !== lastSelection) {
    lastSelection = key;
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
  if (selected && !store.node(selected)) selected = null;
  if (!store.nodeCount) cam = { x: 0, y: 0, zoom: 1 };
  send({ type: 'changes', changes });
  schedule();
}

function run(command: Command): unknown {
  switch (command.op) {
    case 'getNode':
      return store.node(command.id);
    case 'addAfter':
      changed(store.addAfter(command.id, command.node));
      return;
    case 'remove':
      changed(store.remove(command.id));
      return;
    case 'upsertNode':
      changed(store.upsertNode(command.node));
      return;
    case 'chunk':
      store.addChunk(command.chunk);
      schedule();
      return;
  }
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
      break;
    case 'data':
      store.reset(m.nodes, m.edges);
      drag = null; // dragged objects were replaced
      if (selected && !store.node(selected)) selected = null;
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
    case 'theme':
      theme = m.theme;
      colorCache.clear();
      break;
    case 'pointer':
      return onPointer(m.kind, m.x, m.y);
    case 'view':
      cam = zoomAt({ ...cam, x: cam.x + m.panX, y: cam.y + m.panY }, m.x, m.y, m.zoom, cfg.zoom.min, cfg.zoom.max);
      break;
  }
  schedule();
});

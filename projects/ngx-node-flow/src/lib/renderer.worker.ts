/// Runs inside a Worker: owns the canvases, camera and interaction state.
/// Bundled to a string by scripts/build-worker.mjs (see worker-source.ts).
import { bezier, Camera, hitTest, nodeHeight, portPos, Side, toWorld, zoomAt } from './geometry';
import { GlRenderer, RECT_STRIDE, RGBA } from './gl';
import { FlowEdge, FlowNode, FromWorker, NodeFlowConfig, ToWorker } from './types';

const HEADER_TEXT_Y = 12;
const PAD = 10;

let cfg: NodeFlowConfig;
let renderer: GlRenderer;
let text: OffscreenCanvasRenderingContext2D;
let glCanvas: OffscreenCanvas;
let width = 1, height = 1, dpr = 1;
let cam: Camera = { x: 0, y: 0, zoom: 1 };
let nodes: FlowNode[] = [];
let edges: FlowEdge[] = [];
let byId = new Map<string, FlowNode>();
let selected: string | null = null;

type Drag =
  | { kind: 'pan'; sx: number; sy: number }
  | { kind: 'node'; node: FlowNode; dx: number; dy: number; moved: boolean }
  | { kind: 'link'; node: FlowNode; side: Side; port: string; wx: number; wy: number };
let drag: Drag | null = null;

let rects = new Float32Array(0);
let lines = new Float32Array(0);

const send = (msg: FromWorker) => postMessage(msg);

const colorCache = new Map<string, RGBA>();
function rgba(css: string): RGBA {
  let c = colorCache.get(css);
  if (c) return c;
  text.fillStyle = '#000';
  text.fillStyle = css; // the 2D context normalizes any CSS color to #rrggbb or rgba(...)
  const v = String(text.fillStyle);
  if (v.startsWith('#')) {
    c = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).concat(1) as RGBA;
  } else {
    const [r, g, b, a = 1] = v.slice(v.indexOf('(') + 1, -1).split(',').map(Number);
    c = [r / 255, g / 255, b / 255, a];
  }
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
  rects.set([x, y, w, h, c[0], c[1], c[2], c[3], r], i * RECT_STRIDE);
}

function pushCurve(i: number, pts: number[], halfWidth: number): number {
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const [ax, ay, bx, by] = [pts[p], pts[p + 1], pts[p + 2], pts[p + 3]];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * halfWidth, ny = ((bx - ax) / len) * halfWidth;
    lines.set([ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, bx + nx, by + ny, ax - nx, ay - ny, bx - nx, by - ny], i * 2);
    i += 6;
  }
  return i;
}

function render() {
  const c = cfg.node;
  const portColor = rgba(c.portColor);

  let portCount = 0;
  for (const n of nodes) portCount += (n.inputs?.length ?? 0) + (n.outputs?.length ?? 0);
  const rectCount = nodes.length + portCount;
  if (rects.length < rectCount * RECT_STRIDE) rects = new Float32Array(rectCount * RECT_STRIDE * 2);

  let ri = 0;
  for (const n of nodes) {
    const color = n.id === selected ? rgba(c.selectedColor) : rgba(n.color ?? c.color);
    pushRect(ri++, n.x, n.y, c.width, nodeHeight(n, cfg), color, c.radius);
    for (const side of ['in', 'out'] as const) {
      const names = (side === 'in' ? n.inputs : n.outputs) ?? [];
      for (let p = 0; p < names.length; p++) {
        const pos = portPos(n, side, p, cfg);
        const r = c.portRadius;
        pushRect(ri++, pos.x - r, pos.y - r, 2 * r, 2 * r, portColor, r);
      }
    }
  }

  const SEG = 24, VERTS_PER_CURVE = SEG * 6;
  const curveCount = edges.length + (drag?.kind === 'link' ? 1 : 0);
  if (lines.length < curveCount * VERTS_PER_CURVE * 2) lines = new Float32Array(curveCount * VERTS_PER_CURVE * 4);
  let li = 0;
  const hw = cfg.edge.width / 2;
  for (const e of edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
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
    background: rgba(cfg.background),
    grid: cfg.grid.visible ? { size: cfg.grid.size, color: rgba(cfg.grid.color) } : null,
    rects, rectCount: ri,
    lines, lineCount: li,
    lineColor: rgba(cfg.edge.color),
  });
  drawText();
}

function drawText() {
  text.setTransform(1, 0, 0, 1, 0, 0);
  text.clearRect(0, 0, text.canvas.width, text.canvas.height);
  if (cam.zoom < 0.35) return; // unreadable anyway; skip the cost
  text.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * cam.x, dpr * cam.y);
  text.font = cfg.node.font;
  text.fillStyle = cfg.node.textColor;
  text.textBaseline = 'middle';
  const tl = toWorld(cam, 0, 0), br = toWorld(cam, width, height);
  const w = cfg.node.width;
  // shortcut: text lives on a layer above all GL shapes, so overlapping nodes show each other's labels.
  for (const n of nodes) {
    if (n.x > br.x || n.y > br.y || n.x + w < tl.x || n.y + nodeHeight(n, cfg) < tl.y) continue;
    text.textAlign = 'left';
    text.fillText(n.label, n.x + PAD, n.y + HEADER_TEXT_Y, w - 2 * PAD);
    n.inputs?.forEach((name, i) => text.fillText(name, n.x + PAD, portPos(n, 'in', i, cfg).y, w / 2 - PAD));
    text.textAlign = 'right';
    n.outputs?.forEach((name, i) => text.fillText(name, n.x + w - PAD, portPos(n, 'out', i, cfg).y, w / 2 - PAD));
  }
}

function onPointer(kind: 'down' | 'move' | 'up', sx: number, sy: number) {
  const w = toWorld(cam, sx, sy);
  if (kind === 'down') {
    const hit = hitTest(nodes, w.x, w.y, cfg);
    if (hit?.port) {
      drag = { kind: 'link', node: hit.node, side: hit.port.side, port: hit.port.name, wx: w.x, wy: w.y };
    } else if (hit) {
      // bring to front so it draws (and hit-tests) on top
      nodes = [...nodes.filter((n) => n !== hit.node), hit.node];
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
      drag.node.x = w.x - drag.dx;
      drag.node.y = w.y - drag.dy;
      drag.moved = true;
    } else {
      drag.wx = w.x;
      drag.wy = w.y;
    }
  } else if (kind === 'up' && drag) {
    if (drag.kind === 'node') {
      selected = drag.node.id;
      if (drag.moved) send({ type: 'nodeMoved', id: drag.node.id, x: drag.node.x, y: drag.node.y });
      else send({ type: 'nodeClick', id: drag.node.id });
    } else if (drag.kind === 'link') {
      const hit = hitTest(nodes, w.x, w.y, cfg);
      const edge = hit?.port && hit.port.side !== drag.side && hit.node !== drag.node && toEdge(drag, hit.node, hit.port.name);
      if (edge && !edges.some((e) => e.source === edge.source && e.sourcePort === edge.sourcePort && e.target === edge.target && e.targetPort === edge.targetPort)) {
        edges = [...edges, edge];
        send({ type: 'edgeCreated', edge });
      }
    }
    drag = null;
  } else {
    return; // hover move with no drag: nothing changed
  }
  schedule();
}

function toEdge(d: Extract<Drag, { kind: 'link' }>, other: FlowNode, otherPort: string): FlowEdge {
  const [s, sp, t, tp] = d.side === 'out' ? [d.node, d.port, other, otherPort] : [other, otherPort, d.node, d.port];
  return { id: `${s.id}:${sp}->${t.id}:${tp}`, source: s.id, sourcePort: sp, target: t.id, targetPort: tp };
}

addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      cfg = m.config;
      glCanvas = m.gl;
      const gl = m.gl.getContext('webgl2', { antialias: true, premultipliedAlpha: true });
      if (!gl) throw new Error('ngx-node-flow: WebGL2 not available');
      renderer = new GlRenderer(gl);
      text = m.text.getContext('2d')!;
      break;
    }
    case 'resize':
      ({ width, height, dpr } = m);
      for (const c of [glCanvas, text.canvas]) {
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      break;
    case 'data': {
      // keep the locally dragged node's live position until the drag ends
      const d = drag?.kind === 'node' ? drag.node : null;
      nodes = d ? m.nodes.map((n) => (n.id === d.id ? d : n)) : m.nodes;
      edges = m.edges;
      byId = new Map(nodes.map((n) => [n.id, n]));
      break;
    }
    case 'pointer':
      return onPointer(m.kind, m.x, m.y);
    case 'wheel':
      cam = zoomAt(cam, m.x, m.y, Math.exp(-m.deltaY * 0.001), cfg.zoom.min, cfg.zoom.max);
      break;
  }
  schedule();
});

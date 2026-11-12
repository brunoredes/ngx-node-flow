import { FlowEdge, FlowNode } from 'ngx-node-flow';

/** What each demo cell holds in `FlowNode.data`. */
export type CellData =
  | { kind: 'color'; value: string }
  | { kind: 'shape'; value: Shape }
  | { kind: 'zoom'; value: number }
  | { kind: 'result' };
export type CellKind = CellData['kind'];

export const SHAPES = [
  { value: 'circle', label: 'Círculo' },
  { value: 'square', label: 'Quadrado' },
  { value: 'triangle', label: 'Triângulo' },
] as const;
export type Shape = (typeof SHAPES)[number]['value'];

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 100;

export const kindOf = (n: FlowNode): CellKind | undefined => (n.data as Partial<CellData> | undefined)?.kind;

export const initialNodes: FlowNode[] = [
  { id: 'color', x: 40, y: 40, label: 'Cor', outputs: ['cor'], data: { kind: 'color', value: '#3b82f6' } },
  { id: 'shape', x: 40, y: 150, label: 'Forma', outputs: ['forma'], data: { kind: 'shape', value: 'circle' } },
  { id: 'zoom', x: 40, y: 260, label: 'Zoom', outputs: ['zoom'], data: { kind: 'zoom', value: 50 } },
  { id: 'result', x: 360, y: 130, label: 'Resultado', inputs: ['cor', 'forma', 'zoom'], data: { kind: 'result' } },
];

export const initialEdges: FlowEdge[] = [
  { id: 'e-color', source: 'color', sourcePort: 'cor', target: 'result', targetPort: 'cor' },
  { id: 'e-shape', source: 'shape', sourcePort: 'forma', target: 'result', targetPort: 'forma' },
  { id: 'e-zoom', source: 'zoom', sourcePort: 'zoom', target: 'result', targetPort: 'zoom' },
];

export interface ResultValue {
  color?: string;
  shape?: Shape;
  zoom?: number;
}

/**
 * Reads what is wired into the first result cell, by the kind of each connected source
 * (not by port name, so rewiring to any input still counts). Invalid values count as not connected.
 */
export function resolveResult(nodes: FlowNode[], edges: FlowEdge[]): ResultValue | null {
  const result = nodes.find((n) => kindOf(n) === 'result');
  if (!result) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ResultValue = {};
  for (const e of edges) {
    if (e.target !== result.id) continue;
    const d = byId.get(e.source)?.data as Partial<CellData> | undefined;
    if (d?.kind === 'color' && typeof d.value === 'string' && HEX.test(d.value)) out.color = d.value;
    else if (d?.kind === 'shape' && SHAPES.some((s) => s.value === d.value)) out.shape = d.value;
    else if (d?.kind === 'zoom' && typeof d.value === 'number' && d.value >= ZOOM_MIN && d.value <= ZOOM_MAX) out.zoom = d.value;
  }
  return out;
}

export interface FlowNode {
  id: string;
  x: number;
  y: number;
  label: string;
  inputs?: string[];
  outputs?: string[];
  /** A literal CSS color (no var()); falls back to the theme nodeColor. */
  color?: string;
  /** Locked nodes cannot be dragged or removed by the user. */
  locked?: boolean;
  /** Free-form app data, edited by the consumer's editor template. */
  data?: Record<string, unknown>;
}

/** The whole graph as plain arrays, as returned by `snapshot()`. */
export interface GraphSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

/** Visual tokens. Values are any CSS: literals, var(--your-ds-token), light-dark(), color-mix(). */
export interface NodeFlowTheme {
  background: string;
  gridColor: string;
  nodeColor: string;
  nodeSelectedColor: string;
  nodeTextColor: string;
  portColor: string;
  edgeColor: string;
  surface: string;
  text: string;
  border: string;
  accent: string;
  accentText: string;
  fontFamily: string;
  radius: string;
}

/** Theme with every color resolved to rgb()/rgba() on the main thread, for the worker. */
export type ResolvedTheme = Record<keyof NodeFlowTheme, string>;

export interface NodeFlowConfig {
  grid: { size: number; visible: boolean };
  node: { width: number; height: number; radius: number; portRadius: number; fontSize: number };
  /** allowCycles: false refuses a drag-created edge that would close a cycle (loaded data is not checked). */
  edge: { width: number; allowCycles: boolean };
  zoom: { min: number; max: number };
  theme: NodeFlowTheme;
  labels: NodeFlowLabels;
}

/** UI strings (accessible names, buttons, sheet). Defaults are English. */
export interface NodeFlowLabels {
  canvas: string;
  nodeActions: string;
  addNode: string;
  editNode: string;
  removeNode: string;
  addFirstNode: string;
  newNode: string;
  name: string;
  discard: string;
  save: string;
}

/** What `createNode` returns; the library assigns id and position. */
export type NewFlowNode = Omit<FlowNode, 'id' | 'x' | 'y'>;

export type NodeFlowOptions = { [K in keyof NodeFlowConfig]?: Partial<NodeFlowConfig[K]> };

/** A slice of a graph delivered by load(); edges may reference nodes from later chunks. */
export interface GraphChunk {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}

/** What changed in the worker-owned graph. */
export interface GraphChanges {
  upsertNodes: FlowNode[];
  removeNodes: string[];
  upsertEdges: FlowEdge[];
  removeEdges: string[];
}

export type Command =
  | { op: 'addAfter'; id: string; node: FlowNode }
  | { op: 'remove'; id: string }
  | { op: 'upsertNode'; node: FlowNode }
  | { op: 'getNode'; id: string }
  | { op: 'chunk'; chunk: GraphChunk }
  | { op: 'snapshot' }
  | { op: 'fit'; padding: number }
  | { op: 'center'; id: string }
  | { op: 'zoom'; zoom: number }
  | { op: 'select'; ids: string[] };

export type ToWorker =
  | { type: 'init'; gl: OffscreenCanvas; text: OffscreenCanvas; config: NodeFlowConfig; theme: ResolvedTheme }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'data'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'pointer'; kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number }
  /** Pans by (panX, panY) CSS px, then zooms by factor `zoom` around (x, y). */
  | { type: 'view'; x: number; y: number; zoom: number; panX: number; panY: number }
  | { type: 'theme'; theme: ResolvedTheme }
  | { type: 'mode'; readonly: boolean }
  | { type: 'command'; reqId: number; command: Command }
  | { type: 'stream'; reqId: number; stream: ReadableStream<GraphChunk> };

export type FromWorker =
  | { type: 'nodeClick'; id: string }
  | { type: 'edgeCreated'; edge: FlowEdge }
  | { type: 'edgeRejected'; edge: FlowEdge; reason: 'cycle' }
  | { type: 'changes'; changes: GraphChanges }
  | { type: 'stats'; nodes: number; edges: number }
  | { type: 'reply'; reqId: number; value?: unknown; error?: string }
  | { type: 'error'; message: string }
  /** Screen rect (CSS px) of the selected node; id null = nothing selected. */
  | { type: 'selection'; id: string | null; x: number; y: number; w: number; h: number; locked: boolean };

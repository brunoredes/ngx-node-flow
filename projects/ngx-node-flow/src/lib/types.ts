export interface FlowNode {
  id: string;
  x: number;
  y: number;
  label: string;
  inputs?: string[];
  outputs?: string[];
  /** A literal CSS color (no var()); falls back to the theme nodeColor. */
  color?: string;
  /** The start node: removing it clears the whole graph. */
  root?: boolean;
  /** Free-form app data, edited by the consumer's editor template. */
  data?: Record<string, unknown>;
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
  edge: { width: number };
  zoom: { min: number; max: number };
  theme: NodeFlowTheme;
}

export type NodeFlowOptions = { [K in keyof NodeFlowConfig]?: Partial<NodeFlowConfig[K]> };

/** A slice of a graph delivered by load(); edges may reference nodes from later chunks. */
export interface GraphChunk {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}

/** What changed in the worker-owned graph. `clear` means everything was removed before the rest applies. */
export interface GraphChanges {
  clear?: boolean;
  upsertNodes: FlowNode[];
  removeNodes: string[];
  upsertEdges: FlowEdge[];
  removeEdges: string[];
}

export type Command =
  | { op: 'addAfter'; id: string }
  | { op: 'remove'; id: string }
  | { op: 'upsertNode'; node: FlowNode }
  | { op: 'getNode'; id: string }
  | { op: 'chunk'; chunk: GraphChunk };

export type ToWorker =
  | { type: 'init'; gl: OffscreenCanvas; text: OffscreenCanvas; config: NodeFlowConfig; theme: ResolvedTheme }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'data'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'pointer'; kind: 'down' | 'move' | 'up'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; deltaY: number }
  | { type: 'theme'; theme: ResolvedTheme }
  | { type: 'command'; reqId: number; command: Command }
  | { type: 'stream'; reqId: number; stream: ReadableStream<GraphChunk> };

export type FromWorker =
  | { type: 'nodeClick'; id: string }
  | { type: 'edgeCreated'; edge: FlowEdge }
  | { type: 'changes'; changes: GraphChanges }
  | { type: 'stats'; nodes: number; edges: number }
  | { type: 'reply'; reqId: number; value?: unknown; error?: string }
  /** Screen rect (CSS px) of the selected node; id null = nothing selected. */
  | { type: 'selection'; id: string | null; x: number; y: number; w: number; h: number };

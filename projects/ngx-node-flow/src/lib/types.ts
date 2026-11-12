/** A connection point. Edges reference it by `id`, so `label` can change without dropping edges. */
export interface FlowPort {
  id: string;
  /** Shown next to the port; defaults to the id. */
  label?: string;
  /** Matched against `edge.compatibility`; untyped ports connect to anything. */
  type?: string;
  /** Edges this port accepts from user drags; unlimited when omitted. */
  maxConnections?: number;
}

export interface FlowNode {
  id: string;
  x: number;
  y: number;
  label: string;
  /** Port ids must be unique within each list. */
  inputs?: FlowPort[];
  outputs?: FlowPort[];
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
  /**
   * Rules for edges the user drags (loaded data is not checked):
   * - allowCycles: false refuses an edge that would close a cycle.
   * - compatibility: output port type -> input port types it may connect to. A port without a type,
   *   or a type missing from the map, connects to anything. Omit the map to allow every pair.
   */
  edge: { width: number; allowCycles: boolean; compatibility?: Record<string, string[]> };
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
  /** Keyboard instructions, read by screen readers as the canvas description. */
  keyboardHelp: string;
  /** Appended to the focused node's announcement when it is selected. */
  selected: string;
  /** Announced when C starts keyboard connect mode. */
  connectFrom: string;
  /** Prefix of the target node's name while choosing where to connect. */
  connectTo: string;
  connected: string;
  noConnection: string;
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
  | { op: 'select'; ids: string[] }
  | { op: 'selectAll' }
  /** Moves keyboard focus to the nearest node in a direction; keep: leave the selection alone. Replies the focused id. */
  | { op: 'focusNext'; dir: 'left' | 'right' | 'up' | 'down'; keep: boolean }
  | { op: 'toggleFocused' }
  | { op: 'moveSelection'; dx: number; dy: number }
  | { op: 'removeMany'; nodes: string[]; edges: string[] }
  | { op: 'copy' }
  | { op: 'paste'; graph: GraphSnapshot }
  | { op: 'duplicate' }
  /** Connects the first compatible free output of `from` to an input of `to`; replies whether one was found. */
  | { op: 'connectNodes'; from: string; to: string }
  | { op: 'resolveConnect'; ok: boolean }
  | { op: 'undo' }
  | { op: 'redo' };

export type ToWorker =
  | { type: 'init'; gl: OffscreenCanvas; text: OffscreenCanvas; config: NodeFlowConfig; theme: ResolvedTheme }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'data'; nodes: FlowNode[]; edges: FlowEdge[] }
  /** toggle: shift/ctrl/cmd held, adds to or removes from the selection (and drags a selection rectangle on empty space). */
  | { type: 'pointer'; kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; toggle: boolean }
  /** Pans by (panX, panY) CSS px, then zooms by factor `zoom` around (x, y). */
  | { type: 'view'; x: number; y: number; zoom: number; panX: number; panY: number }
  | { type: 'theme'; theme: ResolvedTheme }
  | { type: 'mode'; readonly: boolean; canConnect: boolean }
  | { type: 'command'; reqId: number; command: Command }
  | { type: 'stream'; reqId: number; stream: ReadableStream<GraphChunk> };

export type FromWorker =
  | { type: 'nodeClick'; id: string }
  | { type: 'edgeCreated'; edge: FlowEdge }
  | { type: 'edgeRejected'; edge: FlowEdge; reason: EdgeRejectReason }
  /** A drop passed the declarative rules and waits for the canConnect input (answered by resolveConnect). */
  | { type: 'connectRequest'; edge: FlowEdge }
  | { type: 'changes'; changes: GraphChanges }
  | { type: 'stats'; nodes: number; edges: number }
  /** Undo/redo stack sizes. */
  | { type: 'history'; undo: number; redo: number }
  | { type: 'reply'; reqId: number; value?: unknown; error?: string }
  | { type: 'error'; message: string }
  | { type: 'selected'; nodes: string[]; edges: string[] }
  /** Keyboard focus moved (id null = none), for the live region. */
  | { type: 'focus'; id: string | null; label: string; selected: boolean }
  /** Screen rect (CSS px) of the node the menu attaches to (exactly one node selected); id null = no menu. */
  | { type: 'selection'; id: string | null; x: number; y: number; w: number; h: number; locked: boolean };

/**
 * Why a connection made by the user was refused: `cycle` (edge.allowCycles), `type` (edge.compatibility),
 * `maxConnections` (a port is full) or `custom` (the canConnect input returned false).
 */
export type EdgeRejectReason = 'cycle' | 'type' | 'maxConnections' | 'custom';

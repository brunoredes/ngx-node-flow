import type { EdgeRouting } from './geometry';

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
  /** Image URL (or data: URL) drawn before the label. Cross-origin images need CORS. */
  icon?: string;
  /** Id of the group (frame) this node belongs to; see the `groups` input. */
  group?: string;
  /** Free-form app data, edited by the consumer's editor template. */
  data?: Record<string, unknown>;
}

/** A frame drawn around the nodes whose `group` is this id; collapsed, it is drawn as one node. */
export interface FlowGroup {
  id: string;
  label: string;
  collapsed?: boolean;
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
  /** Text drawn at the middle of the edge. */
  label?: string;
  dashed?: boolean;
  /** Dashes flowing from source to target (static when the user prefers reduced motion). */
  animated?: boolean;
}

/** Runtime state of a node (e.g. while a flow executes). Not part of the graph: not undone, not in graphChange. */
export type NodeStatus = 'idle' | 'running' | 'success' | 'error';

export interface NodeStatusUpdate {
  id: string;
  status: NodeStatus;
  /** Validation or run errors, listed in the node menu and announced to screen readers. */
  errors?: string[];
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
  statusRunning: string;
  statusSuccess: string;
  statusError: string;
  fontFamily: string;
  radius: string;
}

/** Theme with every color resolved to rgb()/rgba() on the main thread, for the worker. */
export type ResolvedTheme = Record<keyof NodeFlowTheme, string>;

export interface NodeFlowConfig {
  /**
   * snap: dragged nodes land on grid points. guides: while dragging, nodes snap to the edges and
   * centers of nodes on screen, with a guide line (wins over grid snapping within a few px).
   */
  grid: { size: number; visible: boolean; snap: boolean; guides: boolean };
  node: { width: number; height: number; radius: number; portRadius: number; fontSize: number };
  /**
   * Rules for edges the user drags (loaded data is not checked):
   * - allowCycles: false refuses an edge that would close a cycle.
   * - compatibility: output port type -> input port types it may connect to. A port without a type,
   *   or a type missing from the map, connects to anything. Omit the map to allow every pair.
   */
  edge: { width: number; allowCycles: boolean; compatibility?: Record<string, string[]>; routing: EdgeRouting };
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
  /** Announced after the node name for each status (idle says nothing). */
  statusRunning: string;
  statusSuccess: string;
  statusError: string;
  /** Accessible name of the error list in the node menu. */
  errors: string;
  /** Announced after a group's name when it is collapsed / expanded. */
  groupCollapsed: string;
  groupExpanded: string;
  /** Description of the sheet's Save and Discard buttons: they close the dialog. */
  closesDialog: string;
  /** Announced when the edit sheet closes, before the focused node: "{changesSaved} {dialogClosed} Node…". */
  dialogClosed: string;
  changesSaved: string;
  changesDiscarded: string;
  /** Arrow key with nothing that way: "{noNode} {dirRight}. {canGo} {dirDown}, {dirLeft}." */
  noNode: string;
  canGo: string;
  dirLeft: string;
  dirRight: string;
  dirUp: string;
  dirDown: string;
  /** Number of nodes the focused node connects to: "no children", "1 child", "2 children". */
  noChildren: string;
  child: string;
  children: string;
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
  | { op: 'find'; text: string; limit: number }
  | { op: 'setStatus'; updates: NodeStatusUpdate[] }
  | { op: 'highlight'; nodes: string[]; edges: string[] }
  /** collapsed omitted: toggles. Replies the new state. */
  | { op: 'toggleGroup'; id: string; collapsed?: boolean }
  | { op: 'expandGroups' }
  | { op: 'groupOfFocused' }
  | { op: 'moveNodes'; positions: { id: string; x: number; y: number }[] }
  | { op: 'exportImage'; type: string }
  | { op: 'fit'; padding: number }
  | { op: 'center'; id: string }
  | { op: 'zoom'; zoom: number }
  | { op: 'select'; ids: string[] }
  | { op: 'selectAll' }
  /** Moves keyboard focus to the nearest node in a direction; keep: leave the selection alone. Replies the focused id. */
  | { op: 'focusNext'; dir: 'left' | 'right' | 'up' | 'down'; keep: boolean }
  | { op: 'toggleFocused' }
  /** Gives keyboard focus (ring + selection) to a node; replies its focus report, or null if it is not there. */
  | { op: 'focusNode'; id: string }
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
  | { type: 'init'; gl: OffscreenCanvas; text: OffscreenCanvas; mini: OffscreenCanvas; config: NodeFlowConfig; theme: ResolvedTheme; baseURI: string }
  /** Pointer on the minimap (CSS px inside it): centers the view there. */
  | { type: 'minimap'; x: number; y: number }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'data'; nodes: FlowNode[]; edges: FlowEdge[] }
  /** toggle: shift/ctrl/cmd held, adds to or removes from the selection (and drags a selection rectangle on empty space). */
  | { type: 'pointer'; kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; toggle: boolean }
  /** Pans by (panX, panY) CSS px, then zooms by factor `zoom` around (x, y). */
  | { type: 'view'; x: number; y: number; zoom: number; panX: number; panY: number }
  | { type: 'theme'; theme: ResolvedTheme }
  | { type: 'groups'; groups: FlowGroup[] }
  | { type: 'mode'; readonly: boolean; canConnect: boolean; minimap: boolean; reducedMotion: boolean }
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
  | { type: 'groupToggled'; id: string; label: string; collapsed: boolean }
  /** Keyboard focus moved (id null = none), for the live region. */
  | { type: 'focus'; id: string | null; label: string; selected: boolean; status: NodeStatus; errors: string[]; children: number }
  /** Screen rect (CSS px) of the node the menu attaches to (exactly one node selected); id null = no menu. */
  | { type: 'selection'; id: string | null; x: number; y: number; w: number; h: number; locked: boolean; errors: string[] };

/**
 * Why a connection made by the user was refused: `cycle` (edge.allowCycles), `type` (edge.compatibility),
 * `maxConnections` (a port is full) or `custom` (the canConnect input returned false).
 */
export type EdgeRejectReason = 'cycle' | 'type' | 'maxConnections' | 'custom';

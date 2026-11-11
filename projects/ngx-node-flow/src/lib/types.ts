export interface FlowNode {
  id: string;
  x: number;
  y: number;
  label: string;
  inputs?: string[];
  outputs?: string[];
  /** Any CSS color; falls back to config.node.color. */
  color?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface NodeFlowConfig {
  background: string;
  grid: { size: number; color: string; visible: boolean };
  node: {
    width: number;
    height: number;
    color: string;
    selectedColor: string;
    textColor: string;
    radius: number;
    font: string;
    portRadius: number;
    portColor: string;
  };
  edge: { color: string; width: number };
  zoom: { min: number; max: number };
}

export type NodeFlowOptions = { [K in keyof NodeFlowConfig]?: Partial<NodeFlowConfig[K]> };

export type ToWorker =
  | { type: 'init'; gl: OffscreenCanvas; text: OffscreenCanvas; config: NodeFlowConfig }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'data'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { type: 'pointer'; kind: 'down' | 'move' | 'up'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; deltaY: number };

export type FromWorker =
  | { type: 'nodeMoved'; id: string; x: number; y: number }
  | { type: 'nodeClick'; id: string }
  | { type: 'edgeCreated'; edge: FlowEdge };

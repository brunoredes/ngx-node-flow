// Every export is semver contract: the worker protocol (ToWorker, FromWorker, Command, ...) stays internal.
export type { FlowNode, FlowPort, FlowEdge, NewFlowNode, NodeFlowTheme, NodeFlowLabels, NodeFlowConfig, NodeFlowOptions, GraphChunk, GraphChanges, GraphSnapshot, NodeStatus, NodeStatusUpdate } from './lib/types';
export { provideNodeFlow, NODE_FLOW_CONFIG, DEFAULT_NODE_FLOW_CONFIG, DEFAULT_NODE_FLOW_THEME } from './lib/config';
export { applyChanges } from './lib/store';
export { EdgeRejectedError, type EdgeRejectReason } from './lib/errors';
export { NodeFlowEditor, type NodeFlowEditorContext } from './lib/node-flow-editor';
export { NodeFlow } from './lib/node-flow';
export type { EdgeRouting } from './lib/geometry';

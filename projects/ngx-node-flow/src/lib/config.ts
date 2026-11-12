import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { NodeFlowConfig, NodeFlowOptions, NodeFlowTheme } from './types';

export const DEFAULT_NODE_FLOW_THEME: NodeFlowTheme = {
  background: '#1a1d23',
  gridColor: '#2a2e36',
  nodeColor: '#2d3748',
  nodeSelectedColor: '#4a6fa5',
  nodeTextColor: '#e2e8f0',
  portColor: '#a0aec0',
  edgeColor: '#718096',
  surface: '#2d3748',
  text: '#e2e8f0',
  border: '#ffffff33',
  accent: '#63b3ed',
  accentText: '#1a202c',
  statusRunning: '#63b3ed',
  statusSuccess: '#48bb78',
  statusError: '#f56565',
  fontFamily: 'system-ui, sans-serif',
  radius: '8px',
};

export const DEFAULT_NODE_FLOW_CONFIG: NodeFlowConfig = {
  grid: { size: 20, visible: true, snap: false, guides: true },
  node: { width: 160, height: 60, radius: 8, portRadius: 6, fontSize: 13 },
  edge: { width: 2, allowCycles: true, routing: 'bezier' },
  zoom: { min: 0.1, max: 4 },
  theme: DEFAULT_NODE_FLOW_THEME,
  labels: {
    canvas: 'Flow editor',
    nodeActions: 'Node actions',
    addNode: 'Add node',
    editNode: 'Edit node',
    removeNode: 'Remove node',
    addFirstNode: 'Add first node',
    newNode: 'New node',
    name: 'Name',
    discard: 'Discard',
    save: 'Save',
    keyboardHelp:
      'Arrow keys move between nodes; Ctrl+arrows move without selecting. Space adds or removes the node from the selection. ' +
      'Shift+arrows move the selection, Enter edits, Delete removes. C, then arrows and Enter, connects two nodes. ' +
      'Ctrl+Z undoes, Ctrl+Y redoes, Ctrl+A selects all, Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate. ' +
      'G collapses or expands the group of the node, Shift+G expands all groups. Escape clears the selection.',
    selected: 'selected',
    connectFrom: 'Connecting: pick the target node with the arrow keys and press Enter, or Escape to cancel',
    connectTo: 'Connect to',
    connected: 'Connected',
    noConnection: 'No compatible free ports between these nodes',
    statusRunning: 'running',
    statusSuccess: 'succeeded',
    statusError: 'failed',
    errors: 'Errors',
    groupCollapsed: 'collapsed',
    groupExpanded: 'expanded',
  },
};

export function mergeConfig(options: NodeFlowOptions): NodeFlowConfig {
  const d = DEFAULT_NODE_FLOW_CONFIG;
  return {
    grid: { ...d.grid, ...options.grid },
    node: { ...d.node, ...options.node },
    edge: { ...d.edge, ...options.edge },
    zoom: { ...d.zoom, ...options.zoom },
    theme: { ...d.theme, ...options.theme },
    labels: { ...d.labels, ...options.labels },
  };
}

export const NODE_FLOW_CONFIG = new InjectionToken<NodeFlowConfig>('NODE_FLOW_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_NODE_FLOW_CONFIG,
});

/** `theme` is optional: omitted tokens fall back to DEFAULT_NODE_FLOW_THEME. */
export function provideNodeFlow(options: NodeFlowOptions = {}) {
  return makeEnvironmentProviders([{ provide: NODE_FLOW_CONFIG, useValue: mergeConfig(options) }]);
}

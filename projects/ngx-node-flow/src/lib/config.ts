import { InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { NodeFlowConfig, NodeFlowOptions } from './types';

export const DEFAULT_NODE_FLOW_CONFIG: NodeFlowConfig = {
  background: '#1a1d23',
  grid: { size: 20, color: '#2a2e36', visible: true },
  node: {
    width: 160,
    height: 60,
    color: '#2d3748',
    selectedColor: '#4a6fa5',
    textColor: '#e2e8f0',
    radius: 8,
    font: '13px sans-serif',
    portRadius: 6,
    portColor: '#a0aec0',
  },
  edge: { color: '#718096', width: 2 },
  zoom: { min: 0.1, max: 4 },
};

export function mergeConfig(options: NodeFlowOptions): NodeFlowConfig {
  const d = DEFAULT_NODE_FLOW_CONFIG;
  return {
    background: options.background ?? d.background,
    grid: { ...d.grid, ...options.grid },
    node: { ...d.node, ...options.node },
    edge: { ...d.edge, ...options.edge },
    zoom: { ...d.zoom, ...options.zoom },
  } as NodeFlowConfig;
}

export const NODE_FLOW_CONFIG = new InjectionToken<NodeFlowConfig>('NODE_FLOW_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_NODE_FLOW_CONFIG,
});

export function provideNodeFlow(options: NodeFlowOptions = {}) {
  return makeEnvironmentProviders([{ provide: NODE_FLOW_CONFIG, useValue: mergeConfig(options) }]);
}

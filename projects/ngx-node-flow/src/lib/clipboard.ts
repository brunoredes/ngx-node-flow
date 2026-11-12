import { FlowEdge, FlowNode, FlowPort, GraphSnapshot } from './types';

const MARK = 'ngx-node-flow/v1';

export const toClipboard = (g: GraphSnapshot) => JSON.stringify({ format: MARK, ...g });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const opt = (v: unknown, test: (v: unknown) => boolean) => v === undefined || test(v);
const isBool = (v: unknown) => typeof v === 'boolean';

const isPort = (p: unknown): p is FlowPort =>
  isObj(p) && isStr(p['id']) && opt(p['label'], isStr) && opt(p['type'], isStr) && opt(p['maxConnections'], isNum);
const isPorts = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(isPort));

const isNode = (n: unknown): n is FlowNode =>
  isObj(n) && isStr(n['id']) && isNum(n['x']) && isNum(n['y']) && isStr(n['label']) &&
  isPorts(n['inputs']) && isPorts(n['outputs']) && opt(n['color'], isStr) && opt(n['locked'], isBool) && opt(n['icon'], isStr) &&
  opt(n['data'], isObj);

const isEdge = (e: unknown): e is FlowEdge =>
  isObj(e) && ['id', 'source', 'sourcePort', 'target', 'targetPort'].every((k) => isStr(e[k])) &&
  opt(e['label'], isStr) && opt(e['dashed'], isBool) && opt(e['animated'], isBool);

/**
 * Reads what `toClipboard` wrote. Clipboard text comes from anywhere, so anything that is not
 * exactly that shape is refused (null) instead of reaching the graph.
 */
export function parseClipboard(text: string): GraphSnapshot | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || v['format'] !== MARK || !Array.isArray(v['nodes']) || !Array.isArray(v['edges'])) return null;
  if (!v['nodes'].every(isNode) || !v['edges'].every(isEdge)) return null;
  return { nodes: v['nodes'], edges: v['edges'] };
}

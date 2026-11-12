import { EdgeRejectReason, FlowEdge } from './types';

export type { EdgeRejectReason };

/** Emitted by `(edgeRejected)` when a dragged connection breaks a graph rule (`edge.allowCycles`, `edge.compatibility`, `maxConnections`, `canConnect`). */
export class EdgeRejectedError extends Error {
  override readonly name = 'EdgeRejectedError';

  constructor(
    readonly edge: FlowEdge,
    readonly reason: EdgeRejectReason,
  ) {
    super(`ngx-node-flow: edge ${edge.source}:${edge.sourcePort} -> ${edge.target}:${edge.targetPort} rejected (${reason})`);
  }
}

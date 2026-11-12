import { FlowEdge } from './types';

/** Why a connection made by the user was refused. */
export type EdgeRejectReason = 'cycle';

/** Emitted by `(edgeRejected)` when a dragged connection breaks a graph policy (e.g. `edge.allowCycles: false`). */
export class EdgeRejectedError extends Error {
  override readonly name = 'EdgeRejectedError';

  constructor(
    readonly edge: FlowEdge,
    readonly reason: EdgeRejectReason,
  ) {
    super(`ngx-node-flow: edge ${edge.source}:${edge.sourcePort} -> ${edge.target}:${edge.targetPort} rejected (${reason})`);
  }
}

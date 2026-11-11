import { Directive, inject, TemplateRef, WritableSignal } from '@angular/core';
import { FlowNode } from './types';

export interface NodeFlowEditorContext {
  /** Draft of the node being edited, applied only on Save. Works directly with Signal Forms: `form(draft)`. */
  $implicit: WritableSignal<FlowNode>;
}

/** `<ng-template nodeFlowEditor let-draft>` inside `<ngx-node-flow>` provides the edit sidesheet's form. */
@Directive({ selector: 'ng-template[nodeFlowEditor]' })
export class NodeFlowEditor {
  readonly template = inject<TemplateRef<NodeFlowEditorContext>>(TemplateRef);

  static ngTemplateContextGuard(_dir: NodeFlowEditor, ctx: unknown): ctx is NodeFlowEditorContext {
    return true;
  }
}

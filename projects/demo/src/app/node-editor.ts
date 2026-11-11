import { Component, effect, model, OnInit, signal, untracked } from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';
import { FlowNode } from 'ngx-node-flow';

type Ports = 'inputs' | 'outputs';

/** Example editor for the sidesheet: edits the draft signal handed over by `nodeFlowEditor`. */
@Component({
  selector: 'app-node-editor',
  imports: [FormField],
  template: `
    <label for="ne-label">Nome</label>
    <input id="ne-label" [formField]="f.label" />
    @if (f.label().invalid() && f.label().touched()) {
      <p class="error" role="alert">O nome é obrigatório.</p>
    }

    <label for="ne-color">Cor</label>
    <input id="ne-color" type="color" [formField]="f.color" />

    @for (side of sides; track side.key) {
      <fieldset>
        <legend>{{ side.title }}</legend>
        @for (port of f[side.key]; track $index) {
          <div class="row">
            <input [formField]="port" [attr.aria-label]="side.title + ' ' + ($index + 1)" />
            <button type="button" (click)="removePort(side.key, $index)" [attr.aria-label]="'Remover ' + side.title + ' ' + ($index + 1)">✕</button>
          </div>
        }
        <button type="button" (click)="addPort(side.key)">Adicionar</button>
      </fieldset>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; --line: color-mix(in srgb, currentColor 35%, transparent); }
    label { font-size: 13px; margin-top: 8px; }
    input { padding: 6px 8px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: inherit; font: inherit; }
    input[type='color'] { padding: 2px; height: 36px; }
    fieldset { border: 1px solid var(--line); border-radius: 6px; margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .row { display: flex; gap: 6px; }
    .row input { flex: 1; }
    button { padding: 6px 10px; border: 1px solid var(--line); background: transparent; color: inherit; }
    .error { color: light-dark(#c53030, #feb2b2); margin: 0; font-size: 13px; }
  `,
})
export class NodeEditor implements OnInit {
  readonly node = model.required<FlowNode>();
  // FlowNode has optional props; the form model needs concrete ones
  private readonly value = signal({ label: '', color: '#2d3748', inputs: [] as string[], outputs: [] as string[] });
  protected readonly f = form(this.value, (p) => required(p.label));
  protected readonly sides = [
    { key: 'inputs', title: 'Entradas' },
    { key: 'outputs', title: 'Saídas' },
  ] as const;
  private ready = false;

  constructor() {
    effect(() => {
      const v = this.value();
      if (this.ready) untracked(() => this.node.update((n) => ({ ...n, ...v })));
    });
  }

  ngOnInit() {
    const n = this.node();
    this.value.set({ label: n.label, color: n.color ?? '#2d3748', inputs: [...(n.inputs ?? [])], outputs: [...(n.outputs ?? [])] });
    this.ready = true;
  }

  protected addPort(side: Ports) {
    this.value.update((v) => ({ ...v, [side]: [...v[side], `porta${v[side].length + 1}`] }));
  }

  protected removePort(side: Ports, i: number) {
    this.value.update((v) => ({ ...v, [side]: v[side].filter((_, j) => j !== i) }));
  }
}

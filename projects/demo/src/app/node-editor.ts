import { Component, effect, linkedSignal, model, OnInit, signal, untracked } from '@angular/core';
import { form, FormField, max, min, pattern, required } from '@angular/forms/signals';
import { FlowNode, FlowPort } from 'ngx-node-flow';
import { CellData, CellKind, HEX, kindOf, Shape, SHAPES, ZOOM_MAX, ZOOM_MIN } from './cells';

type Ports = 'inputs' | 'outputs';
/** The form edits the label; the id stays, so renaming a port keeps its edges. */
type EditablePort = FlowPort & { label: string };

/**
 * Example editor for the sidesheet: edits the draft signal handed over by `nodeFlowEditor`.
 * Demo cells (color / shape / zoom / result) get their own control; other nodes get color and ports.
 */
@Component({
  selector: 'app-node-editor',
  imports: [FormField],
  template: `
    <label>
      Nome
      <input [formField]="f.label" />
    </label>
    @if (f.label().invalid() && f.label().touched()) {
      <p class="error" role="alert">O nome é obrigatório.</p>
    }

    @switch (kind()) {
      @case ('color') {
        <label>
          Cor (hexadecimal)
          <span class="row">
            <input [formField]="f.hex" placeholder="#3b82f6" spellcheck="false" autocomplete="off" />
            <span class="swatch" [style.background]="lastHex()" aria-hidden="true"></span>
          </span>
        </label>
        @if (f.hex().invalid() && f.hex().touched()) {
          <p class="error" role="alert">Use o formato #rrggbb. O valor anterior será mantido.</p>
        }
      }
      @case ('shape') {
        <fieldset>
          <legend>Forma</legend>
          @for (s of shapes; track s.value) {
            <label class="choice">
              <input type="radio" [value]="s.value" [formField]="f.shape" />
              {{ s.label }}
            </label>
          }
        </fieldset>
      }
      @case ('zoom') {
        <label>
          Nível de zoom
          <span class="row">
            <input type="range" [formField]="f.zoom" />
            <output>{{ f.zoom().value() }}%</output>
          </span>
        </label>
      }
      @case ('result') {
        <p class="hint">Esta célula mostra o resultado das células ligadas a ela, no painel ao lado do editor.</p>
      }
      @default {
        <!-- empty color = follow the theme; <input type=color> cannot represent "none" -->
        @if (f.color().value()) {
          <label>
            Cor
            <input type="color" [formField]="f.color" />
          </label>
          <button type="button" (click)="f.color().value.set('')">Usar cor do tema</button>
        } @else {
          <button type="button" (click)="f.color().value.set('#4a5568')">Escolher cor</button>
        }

        @for (side of sides; track side.key) {
          <fieldset>
            <legend>{{ side.title }}</legend>
            @for (port of f[side.key]; track $index) {
              <div class="row">
                <input [formField]="port.label" [attr.aria-label]="side.title + ' ' + ($index + 1)" />
                <button type="button" (click)="removePort(side.key, $index)" [attr.aria-label]="'Remover ' + side.title + ' ' + ($index + 1)">✕</button>
              </div>
            }
            <button type="button" (click)="addPort(side.key)">Adicionar</button>
          </fieldset>
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; --line: color-mix(in srgb, currentColor 35%, transparent); }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; margin-top: 8px; }
    label.choice { flex-direction: row; align-items: center; gap: 8px; margin-top: 0; font-size: 14px; }
    input { padding: 6px 8px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: inherit; font: inherit; }
    input[type='color'] { padding: 2px; height: 36px; }
    input[type='radio'], input[type='range'] { padding: 0; accent-color: var(--demo-accent); }
    fieldset { border: 1px solid var(--line); border-radius: 6px; margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .row { display: flex; gap: 6px; align-items: center; }
    .row input { flex: 1; }
    .row output { min-width: 4ch; text-align: right; }
    .swatch { width: 32px; height: 32px; border-radius: 4px; border: 1px solid var(--line); flex: none; }
    button { padding: 6px 10px; border: 1px solid var(--line); background: transparent; color: inherit; }
    .error { color: light-dark(#c53030, #feb2b2); margin: 0; font-size: 13px; }
    .hint { margin: 8px 0 0; font-size: 13px; }
  `,
})
export class NodeEditor implements OnInit {
  readonly node = model.required<FlowNode>();
  protected readonly kind = signal<CellKind | undefined>(undefined);
  // FlowNode has optional props; the form model needs concrete ones (one field per cell kind)
  private readonly value = signal({
    label: '',
    color: '',
    inputs: [] as EditablePort[],
    outputs: [] as EditablePort[],
    hex: '',
    shape: 'circle' as Shape,
    zoom: 50,
  });
  protected readonly f = form(this.value, (p) => {
    required(p.label);
    required(p.hex, { when: () => this.kind() === 'color' });
    pattern(p.hex, HEX);
    min(p.zoom, ZOOM_MIN);
    max(p.zoom, ZOOM_MAX);
  });
  protected readonly shapes = SHAPES;
  protected readonly sides = [
    { key: 'inputs', title: 'Entradas' },
    { key: 'outputs', title: 'Saídas' },
  ] as const;
  /** Last valid hex, shown in the swatch while the text is being typed. */
  protected readonly lastHex = linkedSignal<string, string>({
    source: () => this.value().hex,
    computation: (hex, prev) => (HEX.test(hex) ? hex : (prev?.value ?? '')),
  });
  private ready = false;

  constructor() {
    effect(() => {
      const { color, hex, shape, zoom, ...v } = this.value();
      if (!this.ready) return;
      const data = this.cellData(hex, shape, zoom);
      untracked(() =>
        this.node.update((n) => {
          const { color: _, ...rest } = n;
          const next: FlowNode = color ? { ...rest, ...v, color } : { ...rest, ...v };
          if (data) next.data = { ...n.data, ...data };
          return next;
        }),
      );
    });
  }

  ngOnInit() {
    const n = this.node();
    const d = n.data as Partial<CellData> | undefined;
    this.kind.set(kindOf(n));
    this.value.set({
      label: n.label,
      color: n.color ?? '',
      inputs: (n.inputs ?? []).map((p) => ({ ...p, label: p.label ?? p.id })),
      outputs: (n.outputs ?? []).map((p) => ({ ...p, label: p.label ?? p.id })),
      hex: d?.kind === 'color' ? (d.value ?? '') : '',
      shape: d?.kind === 'shape' ? (d.value ?? 'circle') : 'circle',
      zoom: d?.kind === 'zoom' ? (d.value ?? 50) : 50,
    });
    this.ready = true;
  }

  /** New cell data, or null to keep the current one (non-cell node, or a hex still being typed). */
  private cellData(hex: string, shape: Shape, zoom: number): CellData | null {
    switch (this.kind()) {
      case 'color':
        if (!HEX.test(hex)) return null;
        return { kind: 'color', value: hex.toLowerCase() };
      case 'shape':
        return { kind: 'shape', value: shape };
      case 'zoom':
        return { kind: 'zoom', value: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) };
      default:
        return null;
    }
  }

  protected addPort(side: Ports) {
    this.value.update((v) => ({ ...v, [side]: [...v[side], { id: crypto.randomUUID(), label: `porta${v[side].length + 1}` }] }));
  }

  protected removePort(side: Ports, i: number) {
    this.value.update((v) => ({ ...v, [side]: v[side].filter((_, j) => j !== i) }));
  }
}

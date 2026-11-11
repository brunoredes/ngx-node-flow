import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  contentChild,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  model,
  output,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { NODE_FLOW_CONFIG } from './config';
import { resolveTheme, themeStyles, watchTheme } from './theme';
import { applyChanges } from './store';
import { iterate, toReadableStream } from './stream';
import { NodeFlowEditor } from './node-flow-editor';
import { Command, FlowEdge, FlowNode, FromWorker, GraphChanges, GraphChunk, NodeFlowTheme, ToWorker } from './types';
import { WORKER_SOURCE } from './worker-source';

type Selection = Extract<FromWorker, { type: 'selection' }> & { id: string };

@Component({
  selector: 'ngx-node-flow',
  imports: [NgTemplateOutlet],
  template: `
    <canvas #gl></canvas><canvas #text></canvas>
    <span #probe hidden></span>

    @if (selection(); as s) {
      <div
        class="nf-overlay nf-menu"
        role="toolbar"
        aria-label="Ações da célula"
        [style.left.px]="s.x + s.w / 2"
        [style.top.px]="s.y"
        (pointerdown)="$event.stopPropagation()"
        (wheel)="$event.stopPropagation()"
      >
        <button type="button" aria-label="Adicionar célula" title="Adicionar célula" (click)="add(s.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" aria-label="Editar célula" title="Editar célula" (click)="edit(s.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
        </button>
        <button type="button" aria-label="Remover célula" title="Remover célula" (click)="remove(s.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        </button>
      </div>
    }

    @if (stats()?.nodes === 0 && !draft()) {
      <button
        type="button"
        class="nf-overlay nf-empty"
        (pointerdown)="$event.stopPropagation()"
        (click)="addFirst()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Adicionar primeira célula
      </button>
    }

    @if (draft(); as draft) {
      <aside
        #sheet
        class="nf-overlay nf-sheet"
        role="dialog"
        aria-labelledby="nf-sheet-title"
        (pointerdown)="$event.stopPropagation()"
        (wheel)="$event.stopPropagation()"
        (keydown.escape)="discard()"
      >
        <h2 id="nf-sheet-title">{{ isNew() ? 'Nova célula' : 'Editar célula' }}</h2>
        <div class="nf-sheet-body">
          @if (editor(); as editor) {
            <ng-container *ngTemplateOutlet="editor.template; context: { $implicit: draft }" />
          } @else {
            <label class="nf-field">
              Nome
              <input [value]="draft().label" (input)="draft.update((n) => ({ ...n, label: $any($event.target).value }))" />
            </label>
          }
        </div>
        <footer>
          <button type="button" (click)="discard()">Descartar</button>
          <button type="button" class="nf-primary" [disabled]="!draft().label.trim()" (click)="save()">Salvar</button>
        </footer>
      </aside>
    }
  `,
  styles: `
    :host { display: block; position: relative; overflow: hidden; touch-action: none; user-select: none; background: var(--__nf-background); }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    canvas + canvas { pointer-events: none; }
    .nf-overlay { position: absolute; color: var(--__nf-text); background: var(--__nf-surface); font: 14px var(--__nf-font-family); }
    button { font: inherit; color: inherit; cursor: pointer; border-radius: calc(var(--__nf-radius) * 0.75); }
    button:focus-visible { outline: 2px solid var(--__nf-accent); outline-offset: 1px; }
    .nf-menu { display: flex; gap: 2px; padding: 4px; border-radius: var(--__nf-radius); transform: translate(-50%, calc(-100% - 8px)); box-shadow: 0 4px 12px #0006; }
    .nf-menu button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: transparent; }
    .nf-menu button:hover { background: color-mix(in srgb, var(--__nf-text) 12%, transparent); }
    .nf-menu svg, .nf-empty svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .nf-sheet { top: 0; right: 0; bottom: 0; width: min(360px, 100%); display: flex; flex-direction: column; box-shadow: -4px 0 16px #0006; user-select: text; }
    .nf-sheet h2 { margin: 0; padding: 16px; font-size: 16px; border-bottom: 1px solid var(--__nf-border); }
    .nf-sheet-body { flex: 1; overflow: auto; padding: 16px; }
    .nf-sheet footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--__nf-border); }
    .nf-sheet footer button { padding: 8px 16px; border: 1px solid var(--__nf-border); background: transparent; }
    .nf-sheet footer .nf-primary { background: var(--__nf-accent); border-color: transparent; color: var(--__nf-accent-text); }
    .nf-sheet footer .nf-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .nf-field { display: flex; flex-direction: column; gap: 6px; }
    .nf-field input { padding: 6px 8px; border-radius: calc(var(--__nf-radius) / 2); border: 1px solid var(--__nf-border); background: transparent; color: inherit; font: inherit; }
    .nf-empty { left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 8px; padding: 12px 20px; border: 1px dashed var(--__nf-accent); border-radius: var(--__nf-radius); box-shadow: 0 4px 12px #0006; }
    .nf-empty:hover { background: color-mix(in srgb, var(--__nf-accent) 15%, var(--__nf-surface)); }
  `,
  host: {
    '[style]': 'themeStyles',
    '(pointerdown)': 'pointer($event, "down")',
    '(pointermove)': 'pointer($event, "move")',
    '(pointerup)': 'pointer($event, "up")',
    '(pointercancel)': 'pointer($event, "up")',
    '(wheel)': 'wheel($event)',
  },
})
export class NodeFlow {
  /**
   * Declarative graph for small/medium sizes, kept in sync both ways.
   * After load() the worker owns the graph and these models are no longer synced; use graphChange and stats.
   */
  readonly nodes = model<FlowNode[]>([]);
  readonly edges = model<FlowEdge[]>([]);
  readonly nodeClick = output<string>();
  readonly edgeCreated = output<FlowEdge>();
  /** Every change to the worker-owned graph (moves, edits, connections), for persistence. */
  readonly graphChange = output<GraphChanges>();

  private readonly _stats = signal<{ nodes: number; edges: number; loading: boolean } | null>(null);
  /** Counts from the worker (null until the first frame) and whether a load() is running. */
  readonly stats = this._stats.asReadonly();

  protected readonly editor = contentChild(NodeFlowEditor);
  protected readonly selection = signal<Selection | null>(null);
  protected readonly draft = signal<WritableSignal<FlowNode> | null>(null);
  /** The draft is a node not yet in the graph (first-node flow). */
  protected readonly isNew = signal(false);

  private readonly config = inject(NODE_FLOW_CONFIG);
  protected readonly themeStyles = themeStyles(this.config.theme);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly glCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('gl');
  private readonly textCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('text');
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly probe = viewChild.required<ElementRef<HTMLElement>>('probe');
  private readonly worker = signal<Worker | undefined>(undefined);
  private returnFocus: HTMLElement | null = null;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextReq = 0;
  private streamed = false;
  private loads = 0;
  /** Last arrays written from worker changes, so the model effect does not echo them back. */
  private echo: { nodes: FlowNode[]; edges: FlowEdge[] } | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const worker = this.worker(), nodes = this.nodes(), edges = this.edges();
      if (!worker || this.streamed || (this.echo?.nodes === nodes && this.echo.edges === edges)) return;
      worker.postMessage({ type: 'data', nodes, edges } satisfies ToWorker);
    });

    // Browser-only (skipped on SSR): canvases must exist before transferring them.
    afterNextRender(() => {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
      worker.onerror = (e) => console.error('ngx-node-flow worker:', e.message);

      const gl = this.glCanvas().nativeElement.transferControlToOffscreen();
      const text = this.textCanvas().nativeElement.transferControlToOffscreen();
      const resolve = () => resolveTheme(this.probe().nativeElement, Object.keys(this.config.theme) as (keyof NodeFlowTheme)[]);
      let theme = resolve();
      worker.postMessage({ type: 'init', gl, text, config: this.config, theme } satisfies ToWorker, [gl, text]);
      const unwatch = watchTheme(this.host, () => {
        const next = resolve();
        if (JSON.stringify(next) === JSON.stringify(theme)) return;
        theme = next;
        worker.postMessage({ type: 'theme', theme } satisfies ToWorker);
      });

      const resize = new ResizeObserver(() => {
        const { width, height } = this.host.getBoundingClientRect();
        worker.postMessage({ type: 'resize', width, height, dpr: devicePixelRatio } satisfies ToWorker);
      });
      resize.observe(this.host);

      this.worker.set(worker);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        unwatch();
        worker.terminate();
        this.pending.forEach((p) => p.reject(new Error('ngx-node-flow destroyed')));
      });
    });
  }

  /**
   * Streams a (possibly huge) graph into the worker, chunk by chunk, appending to what is there.
   * The source is pulled lazily: the next chunk is only requested once the worker has room for it.
   */
  async load(source: AsyncIterable<GraphChunk> | ReadableStream<GraphChunk>, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.streamed = true;
    this.setLoading(+1);
    const stream = toReadableStream(source, options.signal);
    try {
      try {
        await this.call({ type: 'stream', stream }, [stream]);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'DataCloneError')) throw err;
        // no transferable streams (Safari): pump chunks over messages, one in flight at a time
        for await (const chunk of iterate(stream)) await this.command({ op: 'chunk', chunk });
      }
    } finally {
      this.setLoading(-1);
    }
  }

  private setLoading(delta: number) {
    this.loads += delta;
    this._stats.update((s) => ({ nodes: s?.nodes ?? 0, edges: s?.edges ?? 0, loading: this.loads > 0 }));
  }

  private async whenWorker(): Promise<Worker> {
    const ready = this.worker();
    if (ready) return ready;
    return new Promise((resolve) => {
      const ref = effect(() => {
        const w = this.worker();
        if (w) {
          ref.destroy();
          resolve(w);
        }
      }, { injector: this.injector });
    });
  }

  private async call<T>(msg: DistributiveOmit<Extract<ToWorker, { reqId: number }>, 'reqId'>, transfer: Transferable[] = []): Promise<T> {
    const worker = await this.whenWorker();
    const reqId = ++this.nextReq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      try {
        worker.postMessage({ ...msg, reqId } as ToWorker, transfer);
      } catch (err) {
        this.pending.delete(reqId);
        reject(err);
      }
    });
  }

  private command<T = void>(command: Command): Promise<T> {
    return this.call<T>({ type: 'command', command });
  }

  protected add(id: string) {
    void this.command({ op: 'addAfter', id });
  }

  protected addFirst() {
    const { width, height } = this.host.getBoundingClientRect();
    const { node } = this.config;
    // the worker resets the camera on an empty graph, so screen center == world center
    this.openDraft(
      {
        id: crypto.randomUUID(),
        x: Math.round((width - node.width) / 2),
        y: Math.round((height - node.height) / 2),
        label: '',
        root: true,
        outputs: ['out'],
      },
      true,
    );
  }

  protected async edit(id: string) {
    const node = await this.command<FlowNode | undefined>({ op: 'getNode', id });
    if (node) this.openDraft(node, false);
  }

  private openDraft(node: FlowNode, isNew: boolean) {
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.isNew.set(isNew);
    this.draft.set(signal(node));
    afterNextRender(
      () => this.sheet()?.nativeElement.querySelector<HTMLElement>('input, select, textarea, button')?.focus(),
      { injector: this.injector },
    );
  }

  protected async remove(id: string) {
    const node = await this.command<FlowNode | undefined>({ op: 'getNode', id });
    if (node?.root && !confirm('Remover a célula inicial apaga todo o fluxo. Continuar?')) return;
    await this.command({ op: 'remove', id });
    if (this.draft()?.().id === id) this.close();
  }

  protected save() {
    const draft = this.draft()?.();
    if (!draft) return;
    void this.command({ op: 'upsertNode', node: draft });
    this.close();
  }

  protected discard() {
    this.close();
  }

  private close() {
    this.draft.set(null);
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  protected pointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (kind === 'down') this.host.setPointerCapture(e.pointerId);
    const r = this.host.getBoundingClientRect();
    this.worker()?.postMessage({ type: 'pointer', kind, x: e.clientX - r.left, y: e.clientY - r.top } satisfies ToWorker);
  }

  protected wheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.host.getBoundingClientRect();
    this.worker()?.postMessage({ type: 'wheel', x: e.clientX - r.left, y: e.clientY - r.top, deltaY: e.deltaY } satisfies ToWorker);
  }

  private onWorker(m: FromWorker) {
    switch (m.type) {
      case 'changes':
        this.graphChange.emit(m.changes);
        if (!this.streamed) {
          this.echo = applyChanges(this.nodes(), this.edges(), m.changes);
          this.nodes.set(this.echo.nodes);
          this.edges.set(this.echo.edges);
        }
        break;
      case 'stats':
        this._stats.set({ nodes: m.nodes, edges: m.edges, loading: this.loads > 0 });
        break;
      case 'reply': {
        const p = this.pending.get(m.reqId);
        this.pending.delete(m.reqId);
        if (m.error) p?.reject(new Error(m.error));
        else p?.resolve(m.value);
        break;
      }
      case 'nodeClick':
        this.nodeClick.emit(m.id);
        break;
      case 'edgeCreated':
        this.edgeCreated.emit(m.edge);
        break;
      case 'selection':
        this.selection.set(m.id === null ? null : (m as Selection));
        break;
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

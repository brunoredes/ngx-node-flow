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
  input,
  output,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { NODE_FLOW_CONFIG } from './config';
import { resolveTheme, themeStyles, watchTheme } from './theme';
import { iterate, toReadableStream } from './stream';
import { NodeFlowEditor } from './node-flow-editor';
import { EdgeRejectedError } from './errors';
import { Command, FlowEdge, FlowNode, FromWorker, GraphChanges, GraphChunk, GraphSnapshot, NewFlowNode, NodeFlowTheme, ToWorker } from './types';
import { WORKER_SOURCE } from './worker-source';

type Selection = Extract<FromWorker, { type: 'selection' }> & { id: string };

@Component({
  selector: 'ngx-node-flow',
  imports: [NgTemplateOutlet],
  template: `
    <canvas #gl role="img" [attr.aria-label]="l.canvas"></canvas><canvas #text aria-hidden="true"></canvas>
    <span #probe hidden></span>

    @if (!draft() && !readonly() && selection(); as s) {
      <div
        class="nf-overlay nf-menu"
        role="group"
        [attr.aria-label]="l.nodeActions"
        [style.left.px]="s.x + s.w / 2"
        [style.top.px]="s.y"
        (pointerdown)="$event.stopPropagation()"
        (wheel)="$event.stopPropagation()"
      >
        <button type="button" [attr.aria-label]="l.addNode" [title]="l.addNode" (click)="add(s.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" [attr.aria-label]="l.editNode" [title]="l.editNode" (click)="edit(s.id)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
        </button>
        @if (!s.locked) {
          <button type="button" [attr.aria-label]="l.removeNode" [title]="l.removeNode" (click)="remove(s.id)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
          </button>
        }
      </div>
    }

    @if (stats()?.nodes === 0 && !draft() && !readonly()) {
      <button
        type="button"
        class="nf-overlay nf-empty"
        (pointerdown)="$event.stopPropagation()"
        (click)="addFirst()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {{ l.addFirstNode }}
      </button>
    }

    @if (draft(); as draft) {
      <aside
        #sheet
        class="nf-overlay nf-sheet"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        (pointerdown)="$event.stopPropagation()"
        (wheel)="$event.stopPropagation()"
        (keydown.escape)="discard()"
        (keydown)="trapFocus($event)"
      >
        <h2 [id]="titleId">{{ isNew() ? l.newNode : l.editNode }}</h2>
        <div class="nf-sheet-body">
          @if (editor(); as editor) {
            <ng-container *ngTemplateOutlet="editor.template; context: { $implicit: draft }" />
          } @else {
            <label class="nf-field">
              {{ l.name }}
              <input [value]="draft().label" (input)="draft.update((n) => ({ ...n, label: $any($event.target).value }))" />
            </label>
          }
        </div>
        <footer>
          <button type="button" (click)="discard()">{{ l.discard }}</button>
          <button type="button" class="nf-primary" [disabled]="!draft().label.trim()" (click)="save()">{{ l.save }}</button>
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
    '(pointercancel)': 'pointer($event, "cancel")',
    '(wheel)': 'wheel($event)',
  },
})
export class NodeFlow {
  /**
   * Initial graph. The worker owns the graph from then on: user edits are reported through
   * graphChange (fold them with applyChanges if you keep arrays) and never written back here.
   * Setting a new array replaces the whole graph, including anything added by load().
   */
  readonly nodes = input<FlowNode[]>([]);
  readonly edges = input<FlowEdge[]>([]);
  /** Builds the node created by "add" and "add first node"; the library assigns id and position. */
  readonly createNode = input<() => NewFlowNode>();
  /** Called before a node is removed from the menu; return false (or resolve false) to keep it. */
  readonly beforeRemove = input<(node: FlowNode) => boolean | Promise<boolean>>();
  /** View-only: pan, zoom and select still work; nothing in the graph can change. */
  readonly readonly = input(false);
  readonly nodeClick = output<string>();
  readonly edgeCreated = output<FlowEdge>();
  /** A connection dragged by the user was refused by a graph policy; nothing changed in the graph. */
  readonly edgeRejected = output<EdgeRejectedError>();
  /** Every change to the worker-owned graph (moves, edits, connections), for persistence. */
  readonly graphChange = output<GraphChanges>();
  /** The renderer could not start (e.g. no WebGL2) or the worker crashed. */
  readonly error = output<Error>();

  private readonly _stats = signal<{ nodes: number; edges: number; loading: boolean } | null>(null);
  /** Counts from the worker (null until the first frame) and whether a load() is running. */
  readonly stats = this._stats.asReadonly();

  protected readonly editor = contentChild(NodeFlowEditor);
  protected readonly selection = signal<Selection | null>(null);
  protected readonly draft = signal<WritableSignal<FlowNode> | null>(null);
  /** The draft is a node not yet in the graph (first-node flow). */
  protected readonly isNew = signal(false);
  private static instances = 0;
  protected readonly titleId = `nf-sheet-title-${NodeFlow.instances++}`;
  /** Active pointers (CSS px), tracked to turn two touches into a pinch zoom. */
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private readonly config = inject(NODE_FLOW_CONFIG);
  protected readonly themeStyles = themeStyles(this.config.theme);
  protected readonly l = this.config.labels;
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
  private loads = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const worker = this.worker(), nodes = this.nodes(), edges = this.edges();
      worker?.postMessage({ type: 'data', nodes, edges } satisfies ToWorker);
    });
    effect(() => this.worker()?.postMessage({ type: 'mode', readonly: this.readonly() } satisfies ToWorker));

    // Browser-only (skipped on SSR): canvases must exist before transferring them.
    afterNextRender(() => {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
      worker.onerror = (e) => this.fail(`ngx-node-flow worker: ${e.message}`);

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

  /** The whole graph as the worker holds it now: the way to persist without folding every graphChange. */
  snapshot(): Promise<GraphSnapshot> {
    return this.command({ op: 'snapshot' });
  }

  /** Zooms and pans so every node is visible, keeping `padding` CSS px free on each side. */
  fitView(options: { padding?: number } = {}): Promise<void> {
    return this.command({ op: 'fit', padding: options.padding ?? 40 });
  }

  /** Pans so the node is centered, keeping the zoom. Rejects if the node does not exist. */
  centerOn(id: string): Promise<void> {
    return this.command({ op: 'center', id });
  }

  /** Sets the zoom (clamped to config.zoom) around the viewport center. */
  zoomTo(zoom: number): Promise<void> {
    return this.command({ op: 'zoom', zoom });
  }

  /** Selects the given nodes (empty clears the selection). Unknown ids are ignored. */
  select(ids: string[]): Promise<void> {
    return this.command({ op: 'select', ids });
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

  private newNode(): NewFlowNode {
    return this.createNode()?.() ?? { label: this.l.newNode, inputs: ['in'], outputs: ['out'] };
  }

  protected add(id: string) {
    void this.command({ op: 'addAfter', id, node: { ...this.newNode(), id: crypto.randomUUID(), x: 0, y: 0 } });
  }

  protected addFirst() {
    const { width, height } = this.host.getBoundingClientRect();
    const { node } = this.config;
    // the worker resets the camera on an empty graph, so screen center == world center
    this.openDraft(
      {
        ...this.newNode(),
        id: crypto.randomUUID(),
        x: Math.round((width - node.width) / 2),
        y: Math.round((height - node.height) / 2),
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
    if (!node || node.locked || this.readonly() || (await this.beforeRemove()?.(node)) === false) return;
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

  protected trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = this.sheet()?.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!items?.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private post(msg: ToWorker) {
    this.worker()?.postMessage(msg);
  }

  private fail(message: string) {
    console.error(message);
    this.error.emit(new Error(message));
  }

  protected pointer(e: PointerEvent, kind: 'down' | 'move' | 'up' | 'cancel') {
    if (this.draft()) return; // the sheet is modal: editing must not race with drags
    if (kind === 'down' && (e.button !== 0 || this.pointers.size >= 2)) return; // primary button; two touches max
    const r = this.host.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const prev = this.pointers.get(e.pointerId);
    if (kind === 'down') {
      this.host.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, p);
      // second touch: drop whatever the first one was dragging, the pinch takes over
      if (this.pointers.size === 2) return this.post({ type: 'pointer', kind: 'cancel', ...p });
    } else if (kind === 'move' && prev) {
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [, o] = [...this.pointers].find(([id]) => id !== e.pointerId)!;
        const zoom = Math.hypot(p.x - o.x, p.y - o.y) / (Math.hypot(prev.x - o.x, prev.y - o.y) || 1);
        return this.post({ type: 'view', x: (p.x + o.x) / 2, y: (p.y + o.y) / 2, zoom, panX: (p.x - prev.x) / 2, panY: (p.y - prev.y) / 2 });
      }
    } else if (kind === 'up' || kind === 'cancel') {
      const pinching = this.pointers.size === 2;
      this.pointers.delete(e.pointerId);
      if (pinching) return; // the drag was already cancelled when the pinch began
    }
    this.post({ type: 'pointer', kind, ...p });
  }

  protected wheel(e: WheelEvent) {
    e.preventDefault();
    if (this.draft()) return;
    // Firefox reports lines/pages; normalize to px. deltaY zooms (ctrl+wheel = trackpad pinch), deltaX pans.
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.host.clientHeight : 1;
    const r = this.host.getBoundingClientRect();
    this.post({ type: 'view', x: e.clientX - r.left, y: e.clientY - r.top, zoom: Math.exp(-e.deltaY * unit * 0.001), panX: -e.deltaX * unit, panY: 0 });
  }

  private onWorker(m: FromWorker) {
    switch (m.type) {
      case 'changes':
        this.graphChange.emit(m.changes);
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
      case 'error':
        this.fail(m.message);
        break;
      case 'nodeClick':
        this.nodeClick.emit(m.id);
        break;
      case 'edgeCreated':
        this.edgeCreated.emit(m.edge);
        break;
      case 'edgeRejected':
        this.edgeRejected.emit(new EdgeRejectedError(m.edge, m.reason));
        break;
      case 'selection':
        this.selection.set(m.id === null ? null : (m as Selection));
        break;
    }
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

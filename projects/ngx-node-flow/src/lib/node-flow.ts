import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
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
import { MINIMAP } from './geometry';
import { resolveTheme, themeStyles, watchTheme } from './theme';
import { iterate, toReadableStream } from './stream';
import { NodeFlowEditor } from './node-flow-editor';
import { EdgeRejectedError } from './errors';
import { parseClipboard, toClipboard } from './clipboard';
import { Command, FlowEdge, FlowGroup, FlowNode, FromWorker, GraphChanges, GraphChunk, GraphSnapshot, NewFlowNode, NodeStatusUpdate, NodeFlowTheme, ToWorker } from './types';
import { WORKER_SOURCE } from './worker-source';

type Selection = Extract<FromWorker, { type: 'selection' }> & { id: string };

@Component({
  selector: 'ngx-node-flow',
  imports: [NgTemplateOutlet],
  template: `
    <canvas #gl aria-hidden="true"></canvas><canvas #text aria-hidden="true"></canvas>
    <span #probe hidden></span>
    <p class="nf-sr" [id]="helpId">{{ l.keyboardHelp }}</p>
    <p class="nf-sr" aria-live="polite">{{ announcement() }}</p>
    <!-- pointer shortcut only: keyboard users have arrows and fitView() -->
    <canvas
      #mini
      class="nf-minimap"
      aria-hidden="true"
      [hidden]="!minimap()"
      [style.width.px]="miniSize.w"
      [style.height.px]="miniSize.h"
      (pointerdown)="minimapPointer($event)"
      (pointermove)="$event.buttons && minimapPointer($event)"
      (wheel)="$event.stopPropagation()"
    ></canvas>

    @if (!draft() && selection()?.errors?.length) {
      <ul
        class="nf-overlay nf-errors"
        [attr.aria-label]="l.errors"
        [style.left.px]="selection()!.x"
        [style.top.px]="selection()!.y + selection()!.h + 8"
        (pointerdown)="$event.stopPropagation()"
      >
        @for (e of selection()!.errors; track $index) {
          <li>{{ e }}</li>
        }
      </ul>
    }

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
    :host { display: block; position: relative; overflow: hidden; touch-action: none; user-select: none; background: var(--__nf-background); outline: none; }
    :host(:focus-visible) { box-shadow: inset 0 0 0 2px var(--__nf-accent); }
    .nf-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    canvas + canvas { pointer-events: none; }
    .nf-minimap { inset: auto 12px 12px auto; border: 1px solid var(--__nf-border); border-radius: calc(var(--__nf-radius) / 2); cursor: crosshair; }
    .nf-overlay { position: absolute; color: var(--__nf-text); background: var(--__nf-surface); font: 14px var(--__nf-font-family); }
    button { font: inherit; color: inherit; cursor: pointer; border-radius: calc(var(--__nf-radius) * 0.75); }
    button:focus-visible { outline: 2px solid var(--__nf-accent); outline-offset: 1px; }
    .nf-menu { display: flex; gap: 2px; padding: 4px; border-radius: var(--__nf-radius); transform: translate(-50%, calc(-100% - 8px)); box-shadow: 0 4px 12px #0006; }
    .nf-menu button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: transparent; }
    .nf-errors { margin: 0; padding: 6px 10px 6px 24px; max-width: 280px; border-left: 3px solid var(--__nf-status-error); border-radius: calc(var(--__nf-radius) / 2); box-shadow: 0 4px 12px #0006; font-size: 13px; user-select: text; }
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
    // the canvas is one focusable widget: keys move a virtual focus between nodes (see key())
    tabindex: '0',
    role: 'application',
    '[attr.aria-label]': 'l.canvas',
    '[attr.aria-describedby]': 'helpId',
    '(keydown)': 'key($event)',
    '(paste)': 'paste($event)',
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
  /** Overview of the whole graph in the bottom-right corner; click or drag in it to move the view. */
  readonly minimap = input(true);
  /**
   * Frames around nodes whose `group` matches. A click on a frame header (or on a collapsed group) toggles it;
   * G toggles the focused node's group, Shift+G expands all. A new array resets the collapsed state to its flags.
   */
  readonly groups = input<FlowGroup[]>([]);
  /** A group was collapsed or expanded by the user or toggleGroup(). View state: not in graphChange. */
  readonly groupToggle = output<{ id: string; collapsed: boolean }>();
  /**
   * Last word on a connection the user drops, after the declarative rules (edge.compatibility, maxConnections,
   * allowCycles) passed. Return false (or resolve false) to refuse it: edgeRejected fires with reason 'custom'.
   * Runs once per drop, never while dragging.
   */
  readonly canConnect = input<(edge: FlowEdge) => boolean | Promise<boolean>>();
  readonly nodeClick = output<string>();
  readonly edgeCreated = output<FlowEdge>();
  /** A connection dragged by the user was refused by a graph policy; nothing changed in the graph. */
  readonly edgeRejected = output<EdgeRejectedError>();
  /** Every change to the worker-owned graph (moves, edits, connections), for persistence. */
  readonly graphChange = output<GraphChanges>();
  /** The selected node and edge ids, whenever the selection changes. */
  readonly selectionChange = output<{ nodes: string[]; edges: string[] }>();
  /** The renderer could not start (e.g. no WebGL2) or the worker crashed. */
  readonly error = output<Error>();

  private readonly _stats = signal<{ nodes: number; edges: number; loading: boolean } | null>(null);
  /** Counts from the worker (null until the first frame) and whether a load() is running. */
  readonly stats = this._stats.asReadonly();
  private readonly history = signal({ undo: 0, redo: 0 });
  /** Whether undo() / redo() would change something (always false in readonly mode). */
  readonly canUndo = computed(() => !this.readonly() && this.history().undo > 0);
  readonly canRedo = computed(() => !this.readonly() && this.history().redo > 0);

  protected readonly editor = contentChild(NodeFlowEditor);
  protected readonly selection = signal<Selection | null>(null);
  protected readonly draft = signal<WritableSignal<FlowNode> | null>(null);
  /** The draft is a node not yet in the graph (first-node flow). */
  protected readonly isNew = signal(false);
  private static instances = 0;
  private readonly uid = NodeFlow.instances++;
  protected readonly titleId = `nf-sheet-title-${this.uid}`;
  protected readonly helpId = `nf-help-${this.uid}`;
  /** Live region text: the keyboard-focused node, or the result of a keyboard action. */
  protected readonly announcement = signal('');
  private readonly reducedMotion = signal(false);
  private focusedId: string | null = null;
  private selectedIds = { nodes: [] as string[], edges: [] as string[] };
  /** Keyboard connect mode: the node the new edge starts from. */
  private connectFrom: string | null = null;
  /** A keyboard connection waits for canConnect; its outcome is announced when it arrives. */
  private keyboardConnect = false;
  /** Active pointers (CSS px), tracked to turn two touches into a pinch zoom. */
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private readonly config = inject(NODE_FLOW_CONFIG);
  protected readonly themeStyles = themeStyles(this.config.theme);
  protected readonly l = this.config.labels;
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly glCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('gl');
  private readonly textCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('text');
  private readonly miniCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('mini');
  protected readonly miniSize = MINIMAP;
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
    effect(() => this.worker()?.postMessage({ type: 'groups', groups: this.groups() } satisfies ToWorker));
    effect(() => this.worker()?.postMessage({ type: 'mode', readonly: this.readonly(), canConnect: !!this.canConnect(), minimap: this.minimap(), reducedMotion: this.reducedMotion() } satisfies ToWorker));

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
      const mini = this.miniCanvas().nativeElement.transferControlToOffscreen();
      worker.postMessage({ type: 'init', gl, text, mini, config: this.config, theme, baseURI: document.baseURI } satisfies ToWorker, [gl, text, mini]);
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      const onMotion = () => this.reducedMotion.set(motion.matches);
      onMotion();
      motion.addEventListener('change', onMotion);
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
        motion.removeEventListener('change', onMotion);
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
  /** Up to `limit` nodes whose label contains `text` (case-insensitive). Pair with centerOn() and select(). */
  /**
   * Shows runtime state on nodes (a badge, plus errors in the node menu and in announcements).
   * Not part of the graph: not undone, not in graphChange or snapshot(). 'idle' clears a node.
   */
  setStatus(updates: NodeStatusUpdate[]): Promise<void> {
    return this.command({ op: 'setStatus', updates });
  }

  /** Emphasizes these nodes and edges (a path, search results, a trace) and dims the rest. Empty arrays clear it. */
  highlight(nodes: string[], edges: string[] = []): Promise<void> {
    return this.command({ op: 'highlight', nodes, edges });
  }

  /** Collapses or expands a group (omit `collapsed` to toggle); resolves the new state. */
  toggleGroup(id: string, collapsed?: boolean): Promise<boolean> {
    return this.command({ op: 'toggleGroup', id, collapsed });
  }

  /**
   * Moves many nodes at once as one undo step, reported through graphChange.
   * Pairs with `layered()` from 'ngx-node-flow/layout': `flow.moveNodes(layered(nodes, edges))`.
   */
  moveNodes(positions: { id: string; x: number; y: number }[]): Promise<void> {
    return this.command({ op: 'moveNodes', positions });
  }

  /** The current view (not the whole graph: fitView() first for that) as an image. */
  exportImage(type = 'image/png'): Promise<Blob> {
    return this.command({ op: 'exportImage', type });
  }

  findNodes(text: string, limit = 20): Promise<{ id: string; label: string }[]> {
    return this.command({ op: 'find', text, limit });
  }

  protected minimapPointer(e: PointerEvent) {
    e.stopPropagation(); // not a canvas pan/select
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    if (e.type === 'pointerdown') el.setPointerCapture(e.pointerId);
    this.post({ type: 'minimap', x: e.clientX - r.left, y: e.clientY - r.top });
  }

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

  /**
   * Reverts the last user action (move, connection, add, edit, remove) and reports it through graphChange.
   * History holds the last 100 actions and is cleared when the nodes/edges inputs replace the graph.
   */
  undo(): Promise<void> {
    return this.command({ op: 'undo' });
  }

  redo(): Promise<void> {
    return this.command({ op: 'redo' });
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
    return this.createNode()?.() ?? { label: this.l.newNode, inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] };
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

  private async answerConnect(edge: FlowEdge) {
    let ok = false;
    try {
      ok = (await this.canConnect()?.(edge)) ?? true;
    } catch (err) {
      this.fail(`ngx-node-flow canConnect: ${err instanceof Error ? err.message : String(err)}`); // a throwing rule refuses
    }
    await this.command({ op: 'resolveConnect', ok });
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
      if (this.pointers.size === 2) return this.post({ type: 'pointer', kind: 'cancel', ...p, toggle: false });
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
    this.post({ type: 'pointer', kind, ...p, toggle: e.shiftKey || e.ctrlKey || e.metaKey });
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
      case 'history':
        this.history.set({ undo: m.undo, redo: m.redo });
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
        this.settleKeyboardConnect(this.l.connected);
        this.edgeCreated.emit(m.edge);
        break;
      case 'connectRequest':
        void this.answerConnect(m.edge);
        break;
      case 'edgeRejected':
        this.settleKeyboardConnect(this.l.noConnection);
        this.edgeRejected.emit(new EdgeRejectedError(m.edge, m.reason));
        break;
      case 'selection':
        this.selection.set(m.id === null ? null : (m as Selection));
        break;
      case 'groupToggled':
        this.groupToggle.emit({ id: m.id, collapsed: m.collapsed });
        this.announcement.set(`${m.label}, ${m.collapsed ? this.l.groupCollapsed : this.l.groupExpanded}`);
        break;
      case 'selected':
        this.selectedIds = { nodes: m.nodes, edges: m.edges };
        this.selectionChange.emit(this.selectedIds);
        break;
      case 'focus':
        this.focusedId = m.id;
        if (m.id) {
          const status = { idle: '', running: this.l.statusRunning, success: this.l.statusSuccess, error: this.l.statusError }[m.status];
          const parts = [this.connectFrom ? `${this.l.connectTo} ${m.label}` : m.label, m.selected && this.l.selected, status, ...m.errors];
          this.announcement.set(parts.filter(Boolean).join(', '));
        }
        break;
    }
  }

  // --- keyboard ------------------------------------------------------------------

  protected key(e: KeyboardEvent) {
    // keys typed in the menu or the sheet belong to them
    if (e.target !== this.host || this.draft()) return;
    if (this.shortcut(e)) e.preventDefault();
  }

  /** Runs the shortcut for `e`; false when the key is not one of ours (let the browser have it). */
  private shortcut(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), edit = !this.readonly();
    const dir = ARROWS[e.key];
    if (dir && e.shiftKey && !mod && edit) {
      const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
      const step = this.config.grid.size;
      void this.command({ op: 'moveSelection', dx: dx * step, dy: dy * step });
    } else if (dir) {
      void this.command({ op: 'focusNext', dir, keep: mod || !!this.connectFrom });
    } else if (mod && k === 'a') {
      void this.command({ op: 'selectAll' });
    } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      void this.redo();
    } else if (mod && k === 'z') {
      void this.undo();
    } else if (mod && k === 'c') {
      void this.copy();
    } else if (mod && k === 'd' && edit) {
      void this.command({ op: 'duplicate' });
    } else if (mod) {
      return false; // Ctrl+V and browser shortcuts
    } else if (k === 'g' && e.shiftKey) {
      void this.command({ op: 'expandGroups' });
    } else if (k === 'g') {
      void this.command<string | null>({ op: 'groupOfFocused' }).then((id) => id !== null && this.toggleGroup(id));
    } else if (e.key === ' ') {
      void this.command({ op: 'toggleFocused' });
    } else if (e.key === 'Enter') {
      if (this.connectFrom) void this.finishConnect();
      else if (this.focusedId && edit) void this.edit(this.focusedId);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && edit) {
      void this.removeSelected();
    } else if (e.key === 'Escape') {
      if (this.connectFrom) this.connectFrom = null;
      else void this.select([]);
      this.post({ type: 'pointer', kind: 'cancel', x: 0, y: 0, toggle: false });
      this.announcement.set('');
    } else if (k === 'c' && this.focusedId && edit) {
      this.connectFrom = this.focusedId;
      this.announcement.set(this.l.connectFrom);
    } else {
      return false;
    }
    return true;
  }

  private settleKeyboardConnect(text: string) {
    if (!this.keyboardConnect) return;
    this.keyboardConnect = false;
    this.announcement.set(text);
  }

  private async finishConnect() {
    const from = this.connectFrom, to = this.focusedId;
    this.connectFrom = null;
    const found = !!from && !!to && (await this.command<boolean>({ op: 'connectNodes', from, to }));
    if (!found) this.announcement.set(this.l.noConnection);
    else if (this.canConnect()) this.keyboardConnect = true; // announced on edgeCreated / edgeRejected
    else this.announcement.set(this.l.connected);
  }

  /** Removes every selected node and edge; beforeRemove runs per node, and locked nodes stay. */
  private async removeSelected() {
    const { nodes, edges } = this.selectedIds;
    const keep = [];
    for (const id of nodes) {
      const node = await this.command<FlowNode | undefined>({ op: 'getNode', id });
      if (node && !node.locked && (await this.beforeRemove()?.(node)) !== false) keep.push(id);
    }
    await this.command({ op: 'removeMany', nodes: keep, edges });
    if (this.draft() && keep.includes(this.draft()!().id)) this.close();
  }

  private async copy() {
    const graph = await this.command<GraphSnapshot>({ op: 'copy' });
    if (!graph.nodes.length) return;
    try {
      await navigator.clipboard.writeText(toClipboard(graph));
    } catch (err) {
      console.warn('ngx-node-flow: clipboard write refused', err); // e.g. permission denied; nothing to undo
    }
  }

  /** Paste arrives as an event (no clipboard permission prompt); only our own format is accepted. */
  protected paste(e: ClipboardEvent) {
    if (e.target !== this.host || this.draft() || this.readonly()) return;
    const graph = parseClipboard(e.clipboardData?.getData('text/plain') ?? '');
    if (!graph) return;
    e.preventDefault();
    void this.command({ op: 'paste', graph });
  }
}

const ARROWS: Partial<Record<string, 'left' | 'right' | 'up' | 'down'>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

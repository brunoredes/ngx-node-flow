import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NODE_FLOW_CONFIG } from './config';
import { FlowEdge, FlowNode, FromWorker, ToWorker } from './types';
import { WORKER_SOURCE } from './worker-source';

@Component({
  selector: 'ngx-node-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #gl></canvas><canvas #text></canvas>`,
  styles: `
    :host { display: block; position: relative; overflow: hidden; touch-action: none; user-select: none; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    canvas + canvas { pointer-events: none; }
  `,
  host: {
    '(pointerdown)': 'pointer($event, "down")',
    '(pointermove)': 'pointer($event, "move")',
    '(pointerup)': 'pointer($event, "up")',
    '(pointercancel)': 'pointer($event, "up")',
    '(wheel)': 'wheel($event)',
  },
})
export class NodeFlow {
  readonly nodes = model<FlowNode[]>([]);
  readonly edges = model<FlowEdge[]>([]);
  readonly nodeClick = output<string>();
  readonly edgeCreated = output<FlowEdge>();

  private readonly config = inject(NODE_FLOW_CONFIG);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly glCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('gl');
  private readonly textCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('text');
  private readonly worker = signal<Worker | undefined>(undefined);

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => this.worker()?.postMessage({ type: 'data', nodes: this.nodes(), edges: this.edges() } satisfies ToWorker));

    // Browser-only (skipped on SSR): canvases must exist before transferring them.
    afterNextRender(() => {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
      worker.onerror = (e) => console.error('ngx-node-flow worker:', e.message);

      const gl = this.glCanvas().nativeElement.transferControlToOffscreen();
      const text = this.textCanvas().nativeElement.transferControlToOffscreen();
      worker.postMessage({ type: 'init', gl, text, config: this.config } satisfies ToWorker, [gl, text]);

      const resize = new ResizeObserver(() => {
        const { width, height } = this.host.getBoundingClientRect();
        worker.postMessage({ type: 'resize', width, height, dpr: devicePixelRatio } satisfies ToWorker);
      });
      resize.observe(this.host);

      this.worker.set(worker);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        worker.terminate();
      });
    });
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
      case 'nodeMoved':
        // moved node goes last = drawn on top, matching the worker's order
        this.nodes.update((ns) => {
          const node = ns.find((n) => n.id === m.id);
          return node ? [...ns.filter((n) => n !== node), { ...node, x: m.x, y: m.y }] : ns;
        });
        break;
      case 'nodeClick':
        this.nodeClick.emit(m.id);
        break;
      case 'edgeCreated':
        this.edges.update((es) => [...es, m.edge]);
        this.edgeCreated.emit(m.edge);
        break;
    }
  }
}

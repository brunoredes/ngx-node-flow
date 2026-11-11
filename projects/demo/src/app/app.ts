import { Component, DOCUMENT, inject, signal, viewChild } from '@angular/core';
import { FlowEdge, FlowNode, NodeFlow, NodeFlowEditor } from 'ngx-node-flow';
import { generateGraph } from './generate-graph';
import { NodeEditor } from './node-editor';

@Component({
  imports: [NodeFlow, NodeFlowEditor, NodeEditor],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly nodes = signal<FlowNode[]>([
    { id: 'src', x: 40, y: 80, label: 'Source', root: true, outputs: ['data'] },
    { id: 'map', x: 300, y: 40, label: 'Map', inputs: ['in'], outputs: ['out'] },
    { id: 'filter', x: 300, y: 180, label: 'Filter', inputs: ['in'], outputs: ['pass', 'fail'], color: '#553c9a' },
    { id: 'merge', x: 560, y: 100, label: 'Merge', inputs: ['a', 'b'], outputs: ['out'] },
    { id: 'sink', x: 820, y: 120, label: 'Sink', inputs: ['in'] },
  ]);
  protected readonly edges = signal<FlowEdge[]>([
    { id: 'e1', source: 'src', sourcePort: 'data', target: 'map', targetPort: 'in' },
    { id: 'e2', source: 'src', sourcePort: 'data', target: 'filter', targetPort: 'in' },
    { id: 'e3', source: 'map', sourcePort: 'out', target: 'merge', targetPort: 'a' },
    { id: 'e4', source: 'merge', sourcePort: 'out', target: 'sink', targetPort: 'in' },
  ]);
  protected readonly lastEvent = signal('');
  protected readonly light = signal(false);
  protected readonly flow = viewChild(NodeFlow);
  private readonly document = inject(DOCUMENT);
  private abort: AbortController | null = null;
  private batch = 0;

  protected toggleTheme() {
    this.light.update((v) => !v);
    this.document.documentElement.dataset['theme'] = this.light() ? 'light' : 'dark';
  }

  /** Streams 1M nodes into the worker, 10k per chunk, generated only as the worker asks for them. */
  protected async addMany() {
    this.abort = new AbortController();
    const started = performance.now();
    try {
      await this.flow()!.load(generateGraph(1_000_000, 10_000, `b${++this.batch}-`), { signal: this.abort.signal });
      this.lastEvent.set(`1M carregado em ${Math.round(performance.now() - started)} ms`);
    } catch (err) {
      this.lastEvent.set(this.abort.signal.aborted ? 'carregamento cancelado' : `erro: ${(err as Error).message}`);
    } finally {
      this.abort = null;
    }
  }

  protected cancel() {
    this.abort?.abort();
  }
}

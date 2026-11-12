import { Component, computed, DOCUMENT, inject, signal, viewChild } from '@angular/core';
import { applyChanges, EdgeRejectedError, GraphChanges, NodeFlow, NodeFlowEditor } from 'ngx-node-flow';
import { initialEdges, initialNodes, resolveResult } from './cells';
import { generateGraph } from './generate-graph';
import { NodeEditor } from './node-editor';
import { ResultPreview } from './result-preview';

@Component({
  imports: [NodeFlow, NodeFlowEditor, NodeEditor, ResultPreview],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  /** Initial graph only: the worker owns it from here on. */
  protected readonly nodes = initialNodes;
  protected readonly edges = initialEdges;
  /** Our copy of the graph, kept by folding graphChange (feeding it back to [nodes] would reset the worker). */
  private readonly graph = signal({ nodes: initialNodes, edges: initialEdges });
  protected readonly result = computed(() => resolveResult(this.graph().nodes, this.graph().edges));
  protected readonly lastEvent = signal('');
  protected readonly light = signal(false);
  protected readonly flow = viewChild(NodeFlow);
  private readonly document = inject(DOCUMENT);
  private abort: AbortController | null = null;
  private batch = 0;

  protected onGraphChange(change: GraphChanges) {
    this.graph.update((g) => applyChanges(g.nodes, g.edges, change));
  }

  protected onEdgeRejected(err: EdgeRejectedError) {
    if (err.reason === 'cycle') this.lastEvent.set(`conexão recusada: ${err.edge.source} → ${err.edge.target} criaria um ciclo`);
  }

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

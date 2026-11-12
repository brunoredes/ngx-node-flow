import { Component, computed, DOCUMENT, inject, signal, viewChild } from '@angular/core';
import { applyChanges, EdgeRejectedError, GraphChanges, GraphChunk, NodeFlow, NodeFlowEditor } from 'ngx-node-flow';
import { initialEdges, initialNodes, resolveResult } from './cells';
import { generateGraph } from './generate-graph';
import { geojsonGraph } from './geojson-graph';
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
    const why = { cycle: 'criaria um ciclo', type: 'tipos de porta incompatíveis', maxConnections: 'a porta já está ocupada', custom: 'recusada pela regra da aplicação' };
    this.lastEvent.set(`conexão recusada: ${err.edge.source} → ${err.edge.target} (${why[err.reason]})`);
  }

  protected toggleTheme() {
    this.light.update((v) => !v);
    this.document.documentElement.dataset['theme'] = this.light() ? 'light' : 'dark';
  }

  /** Streams 1M nodes into the worker, 10k per chunk, generated only as the worker asks for them. */
  protected addMany() {
    return this.stream('1M', () => generateGraph(1_000_000, 10_000, `b${++this.batch}-`));
  }

  /** San Francisco parcels (public/giant.json), parsed line by line as the download arrives. */
  protected addParcels() {
    return this.stream('giant.json', async (signal) => {
      const res = await fetch('giant.json', { signal });
      if (!res.ok || !res.body) throw new Error(`giant.json: HTTP ${res.status}`);
      return geojsonGraph(res.body, 10_000);
    });
  }

  private async stream(name: string, source: (signal: AbortSignal) => AsyncIterable<GraphChunk> | Promise<AsyncIterable<GraphChunk>>) {
    this.abort = new AbortController();
    const started = performance.now();
    try {
      await this.flow()!.load(await source(this.abort.signal), { signal: this.abort.signal });
      await this.flow()!.fitView();
      this.lastEvent.set(`${name} carregado em ${Math.round(performance.now() - started)} ms`);
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

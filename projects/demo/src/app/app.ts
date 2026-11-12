import { afterNextRender, Component, computed, DOCUMENT, inject, Injector, resource, signal, viewChild } from '@angular/core';
import { applyChanges, EdgeRejectedError, GraphChanges, GraphChunk, NodeFlow, NodeFlowEditor } from 'ngx-node-flow';
import { initialEdges, initialNodes, resolveResult } from './cells';
import { generateGraph } from './generate-graph';
import { Post, PostComment, postGraph } from './post-graph';
import { layered } from 'ngx-node-flow/layout';
import { NodeEditor } from './node-editor';

const API = 'https://jsonplaceholder.typicode.com';

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

@Component({
  imports: [NodeFlow, NodeFlowEditor, NodeEditor],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  /** Input graph: setting it replaces the worker's graph (and clears history); edits come back via graphChange. */
  protected readonly nodes = signal(initialNodes);
  protected readonly edges = signal(initialEdges);
  /** Our copy of the graph, kept by folding graphChange (feeding it back to [nodes] would reset the worker). */
  private readonly graph = signal({ nodes: initialNodes, edges: initialEdges });
  protected readonly result = computed(() => resolveResult(this.graph().nodes, this.graph().edges));
  protected readonly lastEvent = signal('');
  protected readonly light = signal(false);
  protected readonly actionsOpen = signal(false);
  protected readonly flow = viewChild(NodeFlow);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly posts = resource({ loader: ({ abortSignal }) => getJson<Post[]>(`${API}/posts`, abortSignal) });
  protected readonly openPostId = signal<number | null>(null);
  private abort: AbortController | null = null;
  private postRequest: AbortController | null = null;
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

  /** Replaces the graph with the post and its comments. */
  protected async openPost(post: Post) {
    this.cancel(); // a running stream would keep adding chunks into the replaced graph
    this.postRequest?.abort();
    const request = (this.postRequest = new AbortController());
    try {
      const { nodes, edges } = postGraph(post, await getJson<PostComment[]>(`${API}/comments?postId=${post.id}`, request.signal));
      this.openPostId.set(post.id);
      this.nodes.set(nodes);
      this.edges.set(edges);
      this.graph.set({ nodes, edges });
      // the inputs reach the worker on the next change detection; fit after it
      afterNextRender(() => this.flow()?.fitView(), { injector: this.injector });
      this.lastEvent.set(`post ${post.id}: ${edges.length} comentário(s)`);
    } catch (err) {
      // aborted = another card was clicked meanwhile; its result wins
      if (!request.signal.aborted) this.lastEvent.set(`erro ao carregar comentários: ${(err as Error).message}`);
    }
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

  /** Search by label: centers on the first match and highlights every match (empty query clears). */
  protected async search(text: string) {
    const flow = this.flow()!;
    const hits = await flow.findNodes(text);
    await flow.highlight(hits.map((h) => h.id));
    if (hits.length) {
      await flow.centerOn(hits[0].id);
      await flow.select([hits[0].id]);
    }
    this.lastEvent.set(text.trim() ? `busca: ${hits.length} resultado(s)` : '');
  }

  /** Lays the whole graph out left to right; one undo step. */
  protected async arrange() {
    const flow = this.flow()!;
    const { nodes, edges } = await flow.snapshot();
    await flow.moveNodes(layered(nodes, edges));
    await flow.fitView();
  }

  protected async exportPng() {
    const url = URL.createObjectURL(await this.flow()!.exportImage());
    const a = this.document.createElement('a');
    a.href = url;
    a.download = 'fluxo.png';
    a.click();
    URL.revokeObjectURL(url);
  }
}

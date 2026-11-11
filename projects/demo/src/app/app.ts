import { Component, signal } from '@angular/core';
import { FlowEdge, FlowNode, NodeFlow } from 'ngx-node-flow';

@Component({
  imports: [NodeFlow],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly nodes = signal<FlowNode[]>([
    { id: 'src', x: 40, y: 80, label: 'Source', outputs: ['data'] },
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

  protected addMany() {
    const extra = Array.from({ length: 1000 }, (_, i): FlowNode => ({
      id: `n${this.nodes().length + i}`,
      x: (i % 40) * 200,
      y: 400 + Math.floor(i / 40) * 100,
      label: `Node ${i}`,
      inputs: ['in'],
      outputs: ['out'],
    }));
    this.nodes.update((ns) => [...ns, ...extra]);
  }
}

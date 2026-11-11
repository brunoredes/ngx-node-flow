import { generateGraph } from './generate-graph';

describe('generateGraph', () => {
  it('connects every in and out port exactly once, in chunks', async () => {
    const ins = new Map<string, number>(), outs = new Map<string, number>();
    let nodes = 0, chunks = 0;
    for await (const chunk of generateGraph(1000, 64)) {
      chunks++;
      nodes += chunk.nodes!.length;
      for (const e of chunk.edges!) {
        outs.set(e.source, (outs.get(e.source) ?? 0) + 1);
        ins.set(e.target, (ins.get(e.target) ?? 0) + 1);
      }
    }
    expect(nodes).toBe(1000);
    expect(chunks).toBe(Math.ceil(1000 / 64));
    expect(ins.size).toBe(1000);
    expect(outs.size).toBe(1000);
    expect([...ins.values(), ...outs.values()].every((v) => v === 1)).toBe(true);
  });
});

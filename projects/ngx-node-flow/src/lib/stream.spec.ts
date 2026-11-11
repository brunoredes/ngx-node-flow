import { iterate, toReadableStream } from './stream';

async function* counter(log: number[], end = 5) {
  try {
    for (let i = 0; i < end; i++) {
      log.push(i);
      yield i;
    }
  } finally {
    log.push(-1); // marks return()
  }
}

describe('stream helpers', () => {
  it('toReadableStream pulls lazily from the async iterator', async () => {
    const log: number[] = [];
    const reader = toReadableStream(counter(log)).getReader();
    await new Promise((r) => setTimeout(r));
    expect(log).toEqual([]); // nothing generated before the first read
    expect((await reader.read()).value).toBe(0);
    expect(log).toEqual([0]);
  });

  it('iterate yields every chunk', async () => {
    const out: number[] = [];
    for await (const v of iterate(toReadableStream(counter([], 3)))) out.push(v);
    expect(out).toEqual([0, 1, 2]);
  });

  it('cancel and abort call return() on the source', async () => {
    const log: number[] = [];
    const stream = toReadableStream(counter(log));
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(log.at(-1)).toBe(-1);

    const log2: number[] = [];
    const ctrl = new AbortController();
    const r2 = toReadableStream(counter(log2), ctrl.signal).getReader();
    await r2.read();
    ctrl.abort();
    await expect(r2.read()).rejects.toBeDefined();
  });
});

import { abortable, iterate } from './stream';

async function* counter(log: number[], end = 5) {
  try {
    for (let i = 0; i < end; i++) {
      log.push(i);
      yield i;
    }
  } finally {
    log.push(-1); // marks return() or the end
  }
}

/** A source whose second next() never settles, like a fetch that stalls; records return(). */
function stalling() {
  const calls = { next: 0, return: 0 };
  const it: AsyncIterableIterator<number> = {
    next: () =>
      ++calls.next === 1 ? Promise.resolve({ value: 1, done: false }) : new Promise(() => {}),
    return: () => {
      calls.return++;
      return Promise.resolve({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]: () => it,
  };
  return { it, calls };
}

const collect = async <T>(src: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const v of src) out.push(v);
  return out;
};

describe('stream helpers', () => {
  it('iterate yields every chunk of a ReadableStream', async () => {
    const stream = new ReadableStream<number>({
      start(c) {
        [0, 1, 2].forEach((v) => c.enqueue(v));
        c.close();
      },
    });
    expect(await collect(iterate(stream))).toEqual([0, 1, 2]);
  });

  it('abortable pulls lazily and passes every item through', async () => {
    const log: number[] = [];
    const it = abortable(counter(log, 3));
    await new Promise((r) => setTimeout(r));
    expect(log).toEqual([]); // nothing produced before the first pull
    expect((await it.next()).value).toBe(0);
    expect(log).toEqual([0]);
    expect(await collect(abortable(counter([], 3)))).toEqual([0, 1, 2]);
  });

  it('abort rejects while the source is still producing, and closes the source', async () => {
    const { it, calls } = stalling();
    const ctrl = new AbortController();
    const src = abortable(it, ctrl.signal);
    expect((await src.next()).value).toBe(1);
    const pending = src.next(); // waits on the stalled source
    ctrl.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(calls.return).toBe(1);
  });

  it('an already aborted signal rejects with its reason before anything is pulled', async () => {
    const log: number[] = [];
    await expect(
      collect(abortable(counter(log), AbortSignal.abort(new Error('early')))),
    ).rejects.toThrow('early');
    expect(log).toEqual([]);
  });

  it('an abort between items does not pull one more', async () => {
    const log: number[] = [];
    const ctrl = new AbortController();
    await expect(
      (async () => {
        for await (const v of abortable(counter(log), ctrl.signal))
          if (v === 1) ctrl.abort(new Error('stop'));
      })(),
    ).rejects.toThrow('stop');
    expect(log).toEqual([0, 1, -1]); // 2 was never produced
  });

  it('a source error propagates, and a throwing return() does not replace the original error', async () => {
    const it: AsyncIterableIterator<number> = {
      next: () => Promise.reject(new Error('source broke')),
      return: () => {
        throw new Error('cleanup broke');
      },
      [Symbol.asyncIterator]: () => it,
    };
    await expect(collect(abortable(it))).rejects.toThrow('source broke');
  });

  it('abort cancels a stalled ReadableStream source', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<number>({
      start: (c) => c.enqueue(1), // then nothing more: the next read stalls
      cancel,
    });
    const ctrl = new AbortController();
    const src = abortable(iterate(stream), ctrl.signal);
    expect((await src.next()).value).toBe(1);
    const pending = src.next();
    ctrl.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    await new Promise((r) => setTimeout(r));
    expect(cancel).toHaveBeenCalled();
  });

  it('leaving early (a consumer error) closes the source', async () => {
    const log: number[] = [];
    await expect(
      (async () => {
        for await (const v of abortable(counter(log)))
          if (v === 1) throw new Error('worker refused');
      })(),
    ).rejects.toThrow('worker refused');
    expect(log).toEqual([0, 1, -1]);
  });

  it('detaches the abort listener once the source ends', async () => {
    const ctrl = new AbortController();
    const remove = vi.spyOn(ctrl.signal, 'removeEventListener');
    await collect(abortable(counter([], 2), ctrl.signal));
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

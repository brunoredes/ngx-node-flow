/**
 * Reads a ReadableStream as an async iterator (Safari lacks native `for await` over streams).
 * A plain iterator, not a generator: `return()` cancels the stream right away, even while a read is
 * pending (a generator would queue it behind the stalled read).
 */
export function iterate<T>(stream: ReadableStream<T>): AsyncIterableIterator<T> {
  const reader = stream.getReader();
  const it: AsyncIterableIterator<T> = {
    next: () => reader.read() as Promise<IteratorResult<T>>,
    return: async (value?: unknown) => {
      await reader.cancel();
      return { done: true, value };
    },
    [Symbol.asyncIterator]: () => it,
  };
  return it;
}

/**
 * Iterates `source`, rejecting with `signal.reason` as soon as the signal aborts, even while the source
 * is still producing the next item. Leaving early (abort, error, break) calls `return()` on the source.
 */
export async function* abortable<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  let rejectNext = (_: unknown) => {};
  const onAbort = () => rejectNext(signal!.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  let finished = false;
  try {
    for (;;) {
      signal?.throwIfAborted(); // aborted between items: do not pull one more
      // a fresh promise per pull: a single long-lived abort promise raced every time would keep every chunk reachable
      const r = await new Promise<IteratorResult<T>>((resolve, reject) => {
        rejectNext = reject;
        it.next().then(resolve, reject);
      });
      rejectNext = () => {};
      if (r.done) {
        finished = true;
        return;
      }
      yield r.value;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // async wrapper: a return() that throws, even synchronously, must not replace the error that got us here
    if (!finished) (async () => it.return?.())().catch(() => {});
  }
}

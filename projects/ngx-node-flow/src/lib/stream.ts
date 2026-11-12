/** Reads a ReadableStream as an async iterator (Safari lacks native `for await` over streams). */
export async function* iterate<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Wraps an async iterable (or stream) in a pull-based ReadableStream with highWaterMark 0:
 * the source only advances when the consumer (the worker) asks for the next chunk.
 */
export function toReadableStream<T>(source: AsyncIterable<T> | ReadableStream<T>, signal?: AbortSignal): ReadableStream<T> {
  const it = (source instanceof ReadableStream ? iterate(source) : source)[Symbol.asyncIterator]();
  let onAbort = () => {};
  const detach = () => signal?.removeEventListener('abort', onAbort);
  return new ReadableStream<T>(
    {
      start(controller) {
        signal?.throwIfAborted();
        onAbort = () => {
          try {
            controller.error(signal!.reason);
          } catch {
            /* already closed */
          }
          void it.return?.();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      },
      async pull(controller) {
        let r: IteratorResult<T>;
        try {
          r = await it.next();
        } catch (err) {
          detach();
          throw err;
        }
        if (r.done) {
          detach();
          controller.close();
        } else controller.enqueue(r.value);
      },
      async cancel(reason) {
        detach();
        await it.return?.(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

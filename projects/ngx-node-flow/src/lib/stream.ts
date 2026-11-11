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
  return new ReadableStream<T>(
    {
      start(controller) {
        signal?.throwIfAborted();
        signal?.addEventListener(
          'abort',
          () => {
            try {
              controller.error(signal.reason);
            } catch {
              /* already closed */
            }
            void it.return?.();
          },
          { once: true },
        );
      },
      async pull(controller) {
        const r = await it.next();
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      },
      async cancel(reason) {
        await it.return?.(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

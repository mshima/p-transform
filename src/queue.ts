import {Readable, Transform, Duplex} from 'readable-stream';

import PQueue, {type Options, type QueueAddOptions} from 'p-queue';

type OutsidePromise<T> = Promise<T> & {resolve: () => void; reject: (error: any) => void};

export type TransformLike<T = any> = {push: (chunk: T) => void};

export type TransformMethod<T = any> = (this: TransformLike<T>, chunk: T) => PromiseLike<T | undefined> | T | undefined;

const createPromise = <T>() => {
  let resolve;
  let reject;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return Object.assign(promise, {resolve, reject});
};

/**
 * Out of orderer queue result emitter.
 */
export class OutOfOrder<ChunkType> implements AsyncIterable<ChunkType> {
  #queue: PQueue;
  #closed = false;
  #nextPromise: OutsidePromise<ChunkType>;
  #resolve: OutsidePromise<ChunkType>;
  #results: ChunkType[] = [];

  constructor(options?: Options<any, QueueAddOptions>) {
    this.#queue = new PQueue(options);
    this.#resolve = createPromise<ChunkType>();
    this.#nextPromise = createPromise<ChunkType>();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChunkType> {
    while (!this.#closed) {
      // eslint-disable-next-line no-await-in-loop
      await this.#nextPromise;
      const results = this.#results;
      this.#results = [];
      for (const result of results) {
        yield result;
      }

      this.#nextPromise = createPromise<ChunkType>();
    }

    this.#resolve.resolve();
  }

  /**
   * Queue the transform method.
   * Result is queued to be emitted.
   * Additional chunks can be added through `this.push` method.
   */
  add(fn: () => PromiseLike<ChunkType | undefined> | ChunkType | undefined, options?: QueueAddOptions): void {
    if (this.#closed) {
      throw new Error('Queue is already closed');
    }

    this.#queue
      .add(async () => {
        try {
          const result = await fn();
          if (result !== undefined && result !== null) {
            this.push(result);
          }

          this.#nextPromise.resolve();
        } catch (error: unknown) {
          this.#nextPromise.reject(error);
        }
      }, options)
      .catch(error => {
        this.#nextPromise.reject(error);
      });
  }

  createTransformStream(transform: TransformMethod<ChunkType>) {
    const transformContext: TransformLike<ChunkType> = {
      push(chunk) {
        this.push(chunk);
      },
    };
    const writable = new Transform({
      objectMode: true,
      transform: (chunk: ChunkType, _encoding, callback) => {
        this.add(async () => transform.call(transformContext, chunk));
        callback();
      },
      final: async (cb: (error?: any) => void) => {
        await this.close();
        cb();
      },
    });
    return Duplex.from({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      readable: (Readable as any).from(this),
      writable,
    });
  }

  /**
   * Queue chunk to be emitted.
   */
  protected push(chunk: ChunkType) {
    if (this.#closed) {
      throw new Error('Queue is already closed');
    }

    this.#results.push(chunk);
  }

  protected async close() {
    await this.flush();

    this.#closed = true;
    this.#nextPromise.resolve();
    await this.#resolve;
  }

  protected async flush() {
    await this.#queue.onIdle();
    this.#nextPromise.resolve();
  }
}

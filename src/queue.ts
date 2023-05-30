import {Readable, Duplex} from 'node:stream';

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
  #transform: TransformMethod<ChunkType>;

  constructor(transform: TransformMethod<ChunkType>, pqueueOptions?: Options<any, QueueAddOptions>) {
    this.#queue = new PQueue(pqueueOptions);
    this.#resolve = createPromise<ChunkType>();
    this.#nextPromise = createPromise<ChunkType>();
    this.#transform = transform;
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

  push(chunk: ChunkType) {
    const transformContext: TransformLike<ChunkType> = {
      push: chunk => {
        this.pushResult(chunk);
      },
    };

    this.#add(async () => this.#transform.call(transformContext, chunk));
  }

  /**
   * Queue the transform method.
   * Result is queued to be emitted.
   * Additional chunks can be added through `this.push` method.
   */
  #add(fn: () => PromiseLike<ChunkType | undefined> | ChunkType | undefined, options?: QueueAddOptions): void {
    /* c8 ignore next 3 */
    if (this.#closed) {
      throw new Error('Queue is already closed');
    }

    this.#queue
      .add(async () => {
        const result = await fn();
        if (result !== undefined && result !== null) {
          this.pushResult(result);
        }
      }, options)
      .then(
        () => {
          this.#nextPromise.resolve();
        },
        error => {
          this.#nextPromise.reject(error);
        },
      );
  }

  duplex() {
    return Duplex.from({
      readable: Readable.from(this),
      writable: Duplex.from(async generator => {
        for await (const chunk of generator) {
          this.push(chunk);
        }

        await this.close();
      }),
    });
  }

  /**
   * Queue chunk to be emitted.
   */
  protected pushResult(chunk: ChunkType) {
    /* c8 ignore next 3 */
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

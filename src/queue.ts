import {Readable, Duplex} from 'node:stream';
import {setTimeout} from 'node:timers/promises';
import PQueue, {type Options, type QueueAddOptions} from 'p-queue';

type OutsidePromise<T> = Promise<T> & {resolve: () => void; reject: (error: any) => void};

export type TransformLike<T = any> = {push: (chunk: T) => void};

export type TransformMethod<T = any> = (this: TransformLike<T>, chunk: T) => PromiseLike<T | undefined> | T | undefined;

export type DuplexWithDebug = Duplex & {enableDebug: () => Duplex};

// eslint-disable-next-line @typescript-eslint/promise-function-async
const createPromise = <T>() => {
  let resolve;
  let reject;
  // eslint-disable-next-line promise/param-names
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return Object.assign(promise, {resolve, reject});
};

/**
 * Out of orderer queue result emitter.
 */
export class OutOfOrder<ChunkType> implements AsyncIterable<ChunkType> {
  readonly #queue: PQueue;
  #closed = false;
  #nextPromise: OutsidePromise<ChunkType>;
  readonly #resolve: OutsidePromise<ChunkType>;
  readonly #results: ChunkType[] = [];
  readonly #transform: TransformMethod<ChunkType>;
  readonly #logPrefix: string;
  #debugEnabled = false;

  constructor(transform: TransformMethod<ChunkType>, pqueueOptions?: Options<any, QueueAddOptions>) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.#queue = new PQueue(pqueueOptions);
    this.#resolve = createPromise<ChunkType>();
    this.#nextPromise = createPromise<ChunkType>();
    this.#transform = transform;
    this.#logPrefix = Math.random().toString(36).slice(7);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChunkType> {
    while (!this.#closed || this.#queue.size > 0 || this.#queue.pending > 0 || this.#results.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await this.#nextPromise;
      while (this.#results.length > 0) {
        yield this.#results.shift() as Awaited<ChunkType>;
      }

      this.#nextPromise = createPromise<ChunkType>();
    }

    this.debug('queue finished');
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
  #add(function_: () => PromiseLike<ChunkType | undefined> | ChunkType | undefined, options?: QueueAddOptions): void {
    /* c8 ignore next 3 */
    if (this.#closed) {
      throw new Error('Queue is already closed');
    }

    this.#queue
      .add(async () => {
        const result = await function_();
        if (result !== undefined && result !== null) {
          this.pushResult(result);
        }
      }, options)
      // eslint-disable-next-line promise/prefer-await-to-then
      .then(
        () => {
          this.#nextPromise.resolve();
        },
        (error: Error) => {
          this.#nextPromise.reject(error);
        },
      );
  }

  duplex(end?: (this: {push: (chunk: ChunkType) => void}) => void | Promise<void>): DuplexWithDebug {
    const transform = Duplex.from({
      readable: Readable.from(this),
      writable: Duplex.from(async source => {
        for await (const chunk of source) {
          this.push(chunk as ChunkType);
          // Wait next tick to continue.
          // Improves responsiveness since it prioritize chunks to pass through the entire pipeline instead of buffering in a transform.
          if (this.#queue.pending > 1) {
            await setTimeout();
          }
        }

        await this.flush();
        await end?.call?.({
          push: chunk => {
            this.pushResult(chunk);
          },
        });
        await this.close();
      }),
    });
    return Object.assign(transform, {
      enableDebug: () => {
        this.#debugEnabled = true;
        this.debug('debug started');
        return transform;
      },
    });
  }

  /**
   * Queue chunk to be emitted.
   */
  protected pushResult(chunk: ChunkType) {
    this.debug('pushing chunk');
    /* c8 ignore next 3 */
    if (this.#closed) {
      throw new Error('Queue is already closed');
    }

    this.#results.push(chunk);
  }

  protected async close() {
    this.debug('closing');
    await this.flush();

    this.#closed = true;
    this.#nextPromise.resolve();
    await this.#resolve;
    this.debug('closed');
  }

  protected async flush() {
    await this.#queue.onIdle();
    this.#nextPromise.resolve();
  }

  private debug(...arguments_: any[]) {
    if (this.#debugEnabled) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      console.log(`#### ${this.#logPrefix} ####`, ...arguments_);
    }
  }
}

import debug from 'debug';
import PQueue, { type Options as PQueueOptions } from 'p-queue';

import { promisify } from 'util';
import { pipeline as _pipeline, Transform, type TransformCallback } from 'stream';

/**
 * Promisified pipeline
 */
export const pipeline = promisify(_pipeline);

export type TransformMethod = (this: Transform, chunk: any, encoding?: BufferEncoding) => unknown | Promise<unknown>;

export type PTransformOptions = {
  logPrefix?: string;
  logName?: string;
  queueOptions?: PQueueOptions<any, any>;
  transform: TransformMethod;
};

export default class PTransform extends Transform {
  protected logName: string;
  protected queue: PQueue<any, any>;
  private _debug: any;
  private promisedTransform: TransformMethod;

  /**
   * PTransform
   *
   * @param options - Options object forwarded to Transform.
   */
  constructor(options: PTransformOptions) {
    // transform is used locally, forward undefined to prevent conflicts.
    super({ objectMode: true, ...options, transform: undefined });

    const {
      logPrefix,
      logName = `${logPrefix ? logPrefix + '-' : ''}${Math.random().toString(36).slice(7)}`,
      queueOptions,
      transform: promisedTransform,
    } = options;

    this.promisedTransform = promisedTransform;
    this.logName = logName;
    this.queue = new PQueue(queueOptions);
  }

  /**
   * Set log name.
   *
   * @param {String} name
   * @return {PTransform} this
   */
  name(name) {
    if (this._debug) throw new Error(`debug already initialized with name ${this.logName}`);
    this.logName = name;
    return this;
  }

  private get debug() {
    if (this._debug) return this._debug;
    this._debug = debug(`p-transform:${this.logName}`);

    if (this._debug.enabled) {
      this._debug('New PTransform');
      this.on('end', () => this._debug('event:end'));
      this.on('error', error => this._debug('event:error', error));
      this.on('finish', () => this._debug('event:finish'));
      this.on('drain', () => this._debug('event:drain'));
      this.on('close', () => this._debug('event:close'));
      this.on('unpipe', () => this._debug('event:unpipe'));
      this.on('pipe', () => this._debug('event:pipe'));
      this.queue.on('add', () => this._debug('++ task: queue size %d, pending %d', this.queue.size, this.queue.pending));
      this.queue.on('next', () => this._debug('-- task: queue size %d, pending %d', this.queue.size, this.queue.pending));
    }
    return this._debug;
  }

  /**
   * Wait for queue idle.
   *
   * @return Promise<void>
   */
  private flushQueue() {
    return this.queue.onIdle();
  }

  /**
   * Queued transform operation.
   *
   * @param {Object} chunk
   * @param {String} encoding
   * @return Promise
   */
  private async queuedTransform(chunk, encoding) {
    try {
      const maybeChunk = await this.promisedTransform(chunk, encoding);
      if (maybeChunk) {
        this.push(maybeChunk);
      }
    } catch (error) {
      this.debug('destroying %s', error);
      this.destroy(error as Error);
    }
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.debug('_transform %s', chunk.path);
    this.queue.add(() => this.queuedTransform(chunk, encoding));
    setTimeout(() => callback());
  }

  _flush(callback: TransformCallback): void {
    this.debug('_flush');
    this.flushQueue().then(() => callback(), callback);
  }
}

/**
 * Shortcut to create a PTransform with transform and logName.
 */
export const transform = (transform: TransformMethod, logName?: string) => new PTransform({ transform, logName, logPrefix: 'transform' });

/**
 * Shortcut to create a passthrough PTransform with spy and logName.
 */
export const passthrough = (spy?: (this: Transform, chunk: any, encoding?: BufferEncoding) => void | Promise<void>, logName?: string) =>
  new PTransform({
    transform: async function (chunk, encoding) {
      await spy?.call(this, chunk, encoding);
      return chunk;
    },
    logName,
    logPrefix: 'passthrough',
  });

/**
 * Shortcut to create a filter PTransform with filter and logName.
 */
export const filter = (filter: (this: Transform, chunk: any, encoding?: BufferEncoding) => boolean | Promise<boolean>, logName?: string) =>
  new PTransform({
    transform: async function (chunk, encoding) {
      return (await filter.call(this, chunk, encoding)) ? chunk : undefined;
    },
    logName,
    logPrefix: 'filter',
  });

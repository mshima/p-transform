import {promisify} from 'node:util';
import {pipeline as _pipeline, Transform, type TransformCallback} from 'node:stream';
import debug, {type Debugger} from 'debug';
import PQueue, {type Options as PQueueOptions} from 'p-queue';

/**
 * Promisified pipeline
 */
export const pipeline = promisify(_pipeline);

export type TransformMethod = (this: Transform, chunk: any, encoding?: BufferEncoding) => Promise<any> | any;

export type PTransformOptions = {
  logPrefix?: string;
  logName?: string;
  queueOptions?: PQueueOptions<any, any>;
  transform: TransformMethod;
};

export default class PTransform extends Transform {
  protected logName: string;
  protected queue: PQueue<any, any>;
  private _debug?: Debugger;
  private readonly promisedTransform: TransformMethod;

  /**
   * PTransform
   *
   * @param options - Options object forwarded to Transform.
   */
  constructor(options: PTransformOptions) {
    // Transform is used locally, forward undefined to prevent conflicts.
    super({objectMode: true, ...options, transform: undefined});

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
   */
  name(name: string): this {
    if (this._debug) {
      throw new Error(`debug already initialized with name ${this.logName}`);
    }

    this.logName = name;
    return this;
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | undefined) => void): void {
    this.debug('_transform %s', chunk.path);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.queue.add(async () => this.queuedTransform(chunk, encoding));
    setTimeout(() => {
      callback();
    });
  }

  _flush(callback: TransformCallback): void {
    this.debug('_flush');
    this.flushQueue().then(() => {
      callback();
    }, callback);
  }

  private get debug(): Debugger {
    if (this._debug) {
      return this._debug;
    }

    this._debug = debug(`p-transform:${this.logName}`);

    if (this._debug.enabled) {
      this._debug('New PTransform');
      this.on('end', () => {
        this._debug!('event:end');
      });
      this.on('error', error => {
        this._debug!('event:error', error);
      });
      this.on('finish', () => {
        this._debug!('event:finish');
      });
      this.on('drain', () => {
        this._debug!('event:drain');
      });
      this.on('close', () => {
        this._debug!('event:close');
      });
      this.on('unpipe', () => {
        this._debug!('event:unpipe');
      });
      this.on('pipe', () => {
        this._debug!('event:pipe');
      });
      this.queue.on('add', () => {
        this._debug!('++ task: queue size %d, pending %d', this.queue.size, this.queue.pending);
      });
      this.queue.on('next', () => {
        this._debug!('-- task: queue size %d, pending %d', this.queue.size, this.queue.pending);
      });
    }

    return this._debug;
  }

  /**
   * Wait for queue idle.
   */
  private async flushQueue(): Promise<void> {
    return this.queue.onIdle();
  }

  /**
   * Queued transform operation.
   */
  private async queuedTransform(chunk: any, encoding: BufferEncoding): Promise<void> {
    try {
      const maybeChunk = await this.promisedTransform(chunk, encoding);
      if (maybeChunk) {
        this.push(maybeChunk);
      }
    } catch (error: unknown) {
      this.debug('destroying %s', error);
      this.destroy(error as Error);
    }
  }
}

/**
 * Shortcut to create a PTransform with transform and logName.
 */
export const transform = (transform: TransformMethod, logName?: string) => new PTransform({transform, logName, logPrefix: 'transform'});

/**
 * Shortcut to create a passthrough PTransform with spy and logName.
 */
export const passthrough = (spy?: (this: Transform, chunk: any, encoding?: BufferEncoding) => void, logName?: string) =>
  new PTransform({
    async transform(chunk: any, encoding?: BufferEncoding): Promise<any> {
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
    async transform(chunk: any, encoding?: BufferEncoding): Promise<any> {
      const result = await filter.call(this, chunk, encoding);
      return result ? chunk : undefined;
    },
    logName,
    logPrefix: 'filter',
  });

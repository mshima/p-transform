const debug = require('debug');
const { default: PQueue } = require('p-queue');

const { promisify } = require('util');
const { pipeline: _pipeline, Transform } = require('stream');
const pipeline = promisify(_pipeline);

class PTransform extends Transform {
  /**
   * PTransform
   *
   * @param {Object} [options] - Options object forwarded to Transform.
   * @param {String} [options.logName] - Custom name for logger.
   * @param {Function} [options.transform] - Transform function.
   * @param {Object} [options.queueOptions] - Options forwarded to PQueue instance.
   */
  constructor(options = {}) {
    // transform is used locally, forward undefined to prevent conflicts.
    super({ objectMode: true, ...options });

    this.logName = options.logName || Math.random().toString(36).slice(7);
    this.queue = new PQueue(options.queueOptions);

    this.debug = debug(`p-transform:${this.logName}`);

    if (this.debug.enabled) {
      this.debug('New PTransform');
      this.on('end', () => this.debug('event:end'));
      this.on('error', (error) => this.debug('event:error', error));
      this.on('finish', () => this.debug('event:finish'));
      this.on('drain', () => this.debug('event:drain'));
      this.on('close', () => this.debug('event:close'));
      this.on('unpipe', () => this.debug('event:unpipe'));
      this.on('pipe', () => this.debug('event:pipe'));
      this.queue.on('add', () => this.debug('++ task: queue size %d, pending %d', this.queue.size, this.queue.pending));
      this.queue.on('next', () =>
        this.debug('-- task: queue size %d, pending %d', this.queue.size, this.queue.pending)
      );
    }
  }

  /**
   * Wait for queue idle.
   *
   * @return Promise<void>
   */
  flushQueue() {
    return this.queue.onIdle();
  }

  /**
   * Queued transform operation.
   *
   * @param {Object} chunk
   * @param {String} encoding
   * @return Promise
   */
  async queuedTransform(chunk, encoding) {
    try {
      const maybeChunk = await this._transform(chunk, encoding);
      if (maybeChunk) {
        this.push(maybeChunk);
      }
    } catch (error) {
      this.debug('destroying %s', error);
      this.destroy(error);
    }
  }

  _write(chunk, enc, callback) {
    this.debug('_transform %s', chunk.path);
    this.queue.add(() => this.queuedTransform(chunk, enc));
    setTimeout(() => callback());
  }

  _flush(callback) {
    this.debug('_flush');
    this.flushQueue().then(() => callback());
  }
}

/**
 * Shortcut to create a PTransform with transform and logName.
 *
 * @param {Function} transform
 * @param {String} logName
 */
const transform = (transform, logName) => new PTransform({ transform, logName });

/**
 * Shortcut to create a passthrough PTransform with transform and logName.
 *
 * @param {Function} spy
 * @param {String} logName
 */
const passthrough = (spy = () => {}, logName) =>
  transform(async function (chunk, encoding) {
    await spy.call(this, chunk, encoding);
    return chunk;
  }, logName);

module.exports = {
  PTransform,
  pipeline,
  transform,
  passthrough,
};

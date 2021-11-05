const debug = require('debug');
const { default: PQueue } = require('p-queue');

const { promisify } = require('util');
const { pipeline: _pipeline, Transform } = require('stream');
const pipeline = promisify(_pipeline);

class PTransform extends Transform {
  constructor(options) {
    // transform is used locally, forward undefined to prevent conflicts.
    super({ objectMode: true, ...options });

    this.logName = options.logName || Math.random().toString(36).slice(7);
    this.queue = new PQueue();

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

  async _executeTransform(chunk, enc) {
    try {
      const maybeChunk = await this._transform(chunk, enc);
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
    this.queue.add(() => this._executeTransform(chunk, enc));
    setTimeout(() => callback());
  }

  _flush(cb) {
    this.debug('_flush');
    this.queue.onIdle().then(() => cb());
  }
}

module.exports = {
  PTransform,
  pipeline,
  transform: (transform) => new PTransform({ transform }),
};

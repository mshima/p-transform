import type {Duplex} from 'node:stream';
import type {pipeline as pipelineType} from 'node:stream/promises';
import {Stream} from 'readable-stream';
import {type DuplexWithDebug, OutOfOrder, type TransformMethod} from './queue.js';

export * from './queue.js';

const pipeline = Stream.promises.pipeline as typeof pipelineType;
export {pipeline};

export const transform = <ChunkType = any>(transform: TransformMethod<ChunkType>): DuplexWithDebug => {
  return new OutOfOrder<ChunkType>(transform).duplex();
};

/**
 * Shortcut to create a passthrough with spy.
 */
export const passthrough = <ChunkType = any>(spy?: (chunk: ChunkType) => Promise<void> | void): DuplexWithDebug =>
  transform(async (chunk: ChunkType) => {
    await spy?.(chunk);
    return chunk;
  });

/**
 * Create a filter stream.
 */
export const filter = <ChunkType = any>(filter: (chunk: ChunkType) => boolean | Promise<boolean>): DuplexWithDebug =>
  transform(async function (chunk: ChunkType) {
    const result = await filter(chunk);
    return result ? chunk : undefined;
  });

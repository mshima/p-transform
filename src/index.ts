import readableStream from 'readable-stream';
import {OutOfOrder, type TransformMethod} from './queue.js';

const {pipeline} = readableStream.promises;
export {pipeline};

export const transform = <ChunkType = any>(transform: TransformMethod<ChunkType>) => {
  return new OutOfOrder<ChunkType>().createTransformStream(transform);
};

/**
 * Shortcut to create a passthrough with spy.
 */
export const passthrough = <ChunkType = any>(spy?: (chunk: ChunkType) => Promise<void> | void) =>
  transform(async (chunk: ChunkType) => {
    await spy?.(chunk);
    return chunk;
  });

/**
 * Create a filter stream.
 */
export const filter = <ChunkType = any>(filter: (chunk: ChunkType) => boolean | Promise<boolean>) =>
  transform(async function (chunk: ChunkType) {
    const result = await filter(chunk);
    return result ? chunk : undefined;
  });

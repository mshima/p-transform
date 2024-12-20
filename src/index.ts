import {type DuplexWithDebug, OutOfOrder, type TransformMethod, type TransformLike} from './queue.js';

export * from './queue.js';

export const transform = <ChunkType = any>(
  transform: TransformMethod<ChunkType>,
  end?: (this: TransformLike<ChunkType>) => void | Promise<void>,
): DuplexWithDebug => {
  return new OutOfOrder<ChunkType>(transform).duplex(end);
};

/**
 * Shortcut to create a passthrough with spy.
 */
export const passthrough = <ChunkType = any>(
  spy?: (this: TransformLike<ChunkType>, chunk: ChunkType) => Promise<void> | void,
  end?: (this: TransformLike<ChunkType>) => void | Promise<void>,
): DuplexWithDebug =>
  transform(async function (chunk: ChunkType) {
    await spy?.call(this, chunk);
    return chunk;
  }, end);

/**
 * Create a filter stream.
 */
export const filter = <ChunkType = any>(
  filter: (chunk: ChunkType) => boolean | Promise<boolean>,
  end?: (this: TransformLike<ChunkType>) => void,
): DuplexWithDebug =>
  transform(async function (chunk: ChunkType) {
    const result = await filter(chunk);
    return result ? chunk : undefined;
  }, end);

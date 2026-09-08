import { isUtf8 } from 'node:buffer';
import type { PoolWorkerKind } from '../pool/types';
import type { AssetFileContent, AssetFiles } from '../types/worker';

type BinaryAssetFileContent = Exclude<AssetFileContent, string>;

const bufferCache = new WeakMap<BinaryAssetFileContent, Buffer>();
const textCache = new WeakMap<BinaryAssetFileContent, string>();

const toBuffer = (content: BinaryAssetFileContent): Buffer => {
  if ('encoding' in content) {
    return Buffer.from(content.data, 'base64');
  }
  if (Buffer.isBuffer(content)) {
    return content;
  }
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
};

export const prepareAssetFilesForIPC = (
  assetFiles: Record<string, Buffer>,
  workerKind: PoolWorkerKind,
): AssetFiles => {
  if (workerKind === 'threads' || process.versions.bun === undefined) {
    return assetFiles;
  }

  return Object.fromEntries(
    Object.entries(assetFiles).map(([name, content]) => [
      name,
      isUtf8(content)
        ? content.toString('utf8')
        : { encoding: 'base64', data: content.toString('base64') },
    ]),
  );
};

const getCachedBuffer = (content: BinaryAssetFileContent): Buffer => {
  const cached = bufferCache.get(content);
  if (cached) {
    return cached;
  }

  const buffer = toBuffer(content);
  bufferCache.set(content, buffer);
  return buffer;
};

export const getAssetBuffer = (
  assetFiles: AssetFiles,
  name: string,
): Buffer => {
  const content = assetFiles[name]!;
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }

  return Buffer.from(getCachedBuffer(content));
};

export const getAssetText = (assetFiles: AssetFiles, name: string): string => {
  const content = assetFiles[name]!;
  if (typeof content === 'string') {
    return content;
  }

  const cached = textCache.get(content);
  if (cached !== undefined) {
    return cached;
  }

  const text = getCachedBuffer(content).toString('utf8');
  textCache.set(content, text);
  return text;
};

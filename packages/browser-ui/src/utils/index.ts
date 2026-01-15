import { clsx } from 'clsx';

export function cn(
  ...inputs: Array<string | undefined | null | false>
): string {
  return clsx(inputs);
}

export const toRelativePath = (file: string, rootPath?: string): string => {
  if (!rootPath) return file;
  const normalizedRoot = rootPath.endsWith('/')
    ? rootPath.slice(0, -1)
    : rootPath;
  if (file.startsWith(normalizedRoot)) {
    const sliced = file.slice(normalizedRoot.length);
    return sliced.startsWith('/') ? sliced.slice(1) : sliced;
  }
  return file;
};

export const openInEditor = (file: string): void => {
  const payload = { type: 'open-in-editor', payload: { file } };
  window.parent?.postMessage(payload, '*');
  fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`).catch(() => {});
};

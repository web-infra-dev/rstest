export function mountPatch(
  host: HTMLElement,
  options?: {
    value?: number;
    play?: boolean;
    onPick?: (
      name: 'rsbuild' | 'rslib' | 'rspack' | 'lynx' | 'modernjs',
    ) => void;
  },
): () => void;

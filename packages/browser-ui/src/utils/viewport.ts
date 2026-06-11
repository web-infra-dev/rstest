import {
  type DevicePreset,
  getPresetInfo,
  isDevicePreset,
} from './viewportPresets';

type BrowserViewport =
  | {
      width: number;
      height: number;
    }
  | DevicePreset;

export type ViewportSelection =
  | { mode: 'full' }
  | { mode: 'responsive'; width: number; height: number }
  | {
      mode: 'preset';
      preset: DevicePreset;
      orientation: 'portrait' | 'landscape';
    };

export const viewportSizeOf = (
  selection: ViewportSelection,
): { width: number; height: number } | null => {
  if (selection.mode === 'full') {
    return null;
  }

  if (selection.mode === 'responsive') {
    return { width: selection.width, height: selection.height };
  }

  const info = getPresetInfo(selection.preset);
  return selection.orientation === 'landscape'
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height };
};

/**
 * Sole owner of the "valid responsive dimensions" rule: both axes must be
 * finite and strictly positive. Shared by {@link selectionFromConfig} (decoding
 * a config object) and `readStoredViewport` in main.tsx (decoding persisted
 * localStorage state) so a future viewport field can never diverge between the
 * two decoders.
 */
export const isPositiveFiniteSize = (width: number, height: number): boolean =>
  Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;

export const selectionFromConfig = (
  viewport: BrowserViewport | undefined,
): ViewportSelection => {
  // Default: fill the preview panel.
  if (!viewport) {
    return { mode: 'full' };
  }

  if (typeof viewport === 'string' && isDevicePreset(viewport)) {
    return {
      mode: 'preset',
      preset: viewport,
      orientation: 'portrait',
    };
  }

  if (typeof viewport === 'object') {
    const width = Number((viewport as any).width);
    const height = Number((viewport as any).height);
    if (isPositiveFiniteSize(width, height)) {
      // In DevTools terms, this is a custom responsive viewport.
      return { mode: 'responsive', width, height };
    }
  }

  return { mode: 'full' };
};

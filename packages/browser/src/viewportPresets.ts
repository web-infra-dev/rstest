/**
 * Runtime source of truth for browser viewport presets.
 *
 * IMPORTANT: Keep this list/map in sync with `DevicePreset` typing in
 * `@rstest/core` (`packages/core/src/types/config.ts`) so `defineConfig`
 * autocomplete and runtime validation stay consistent.
 */
export const BROWSER_VIEWPORT_PRESET_IDS = [
  'iPhoneSE',
  'iPhoneXR',
  'iPhone12Pro',
  'iPhone14ProMax',
  'Pixel7',
  'SamsungGalaxyS8Plus',
  'SamsungGalaxyS20Ultra',
  'iPadMini',
  'iPadAir',
  'iPadPro',
  'SurfacePro7',
  'SurfaceDuo',
  'GalaxyZFold5',
  'AsusZenbookFold',
  'SamsungGalaxyA51A71',
  'NestHub',
  'NestHubMax',
] as const;

type BrowserViewportPresetId = (typeof BROWSER_VIEWPORT_PRESET_IDS)[number];

type BrowserViewportSize = {
  width: number;
  height: number;
};

export const BROWSER_VIEWPORT_PRESET_DIMENSIONS: Record<
  BrowserViewportPresetId,
  BrowserViewportSize
> = {
  iPhoneSE: { width: 375, height: 667 },
  iPhoneXR: { width: 414, height: 896 },
  iPhone12Pro: { width: 390, height: 844 },
  iPhone14ProMax: { width: 430, height: 932 },
  Pixel7: { width: 412, height: 915 },
  SamsungGalaxyS8Plus: { width: 360, height: 740 },
  SamsungGalaxyS20Ultra: { width: 412, height: 915 },
  iPadMini: { width: 768, height: 1024 },
  iPadAir: { width: 820, height: 1180 },
  iPadPro: { width: 1024, height: 1366 },
  SurfacePro7: { width: 912, height: 1368 },
  SurfaceDuo: { width: 540, height: 720 },
  GalaxyZFold5: { width: 344, height: 882 },
  AsusZenbookFold: { width: 853, height: 1280 },
  SamsungGalaxyA51A71: { width: 412, height: 914 },
  NestHub: { width: 1024, height: 600 },
  NestHubMax: { width: 1280, height: 800 },
};

export const resolveBrowserViewportPreset = (
  presetId: string,
): BrowserViewportSize | null => {
  const size =
    BROWSER_VIEWPORT_PRESET_DIMENSIONS[presetId as BrowserViewportPresetId];
  return size ?? null;
};

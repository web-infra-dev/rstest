import {
  BROWSER_VIEWPORT_PRESET_DIMENSIONS,
  BROWSER_VIEWPORT_PRESET_IDS,
} from '@rstest/browser/viewport-presets';
import type { DevicePreset } from '@rstest/core/browser';

export type { DevicePreset };

export type DevicePresetInfo = {
  id: DevicePreset;
  label: string;
  width: number;
  height: number;
};

const DEVICE_PRESET_LABELS: Record<DevicePreset, string> = {
  iPhoneSE: 'iPhone SE',
  iPhoneXR: 'iPhone XR',
  iPhone12Pro: 'iPhone 12 Pro',
  iPhone14ProMax: 'iPhone 14 Pro Max',
  Pixel7: 'Pixel 7',
  SamsungGalaxyS8Plus: 'Samsung Galaxy S8+',
  SamsungGalaxyS20Ultra: 'Samsung Galaxy S20 Ultra',
  iPadMini: 'iPad Mini',
  iPadAir: 'iPad Air',
  iPadPro: 'iPad Pro',
  SurfacePro7: 'Surface Pro 7',
  SurfaceDuo: 'Surface Duo',
  GalaxyZFold5: 'Galaxy Z Fold 5',
  AsusZenbookFold: 'Asus Zenbook Fold',
  SamsungGalaxyA51A71: 'Samsung Galaxy A51/71',
  // Nest Hub devices only expose a single (horizontal) mode in DevTools.
  NestHub: 'Nest Hub',
  NestHubMax: 'Nest Hub Max',
};

export const DEVICE_PRESETS: DevicePresetInfo[] =
  BROWSER_VIEWPORT_PRESET_IDS.map((id) => {
    const dimensions = BROWSER_VIEWPORT_PRESET_DIMENSIONS[id];
    return {
      id,
      label: DEVICE_PRESET_LABELS[id],
      width: dimensions.width,
      height: dimensions.height,
    };
  });

const presetIds = new Set<DevicePreset>(DEVICE_PRESETS.map((p) => p.id));

export const isDevicePreset = (value: unknown): value is DevicePreset =>
  typeof value === 'string' && presetIds.has(value as DevicePreset);

export const getPresetInfo = (id: DevicePreset): DevicePresetInfo => {
  const found = DEVICE_PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`Unknown device preset: ${id}`);
  }
  return found;
};

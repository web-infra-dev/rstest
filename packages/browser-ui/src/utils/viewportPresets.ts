import type { DevicePreset } from '@rstest/core/browser';

export type { DevicePreset };

export type DevicePresetInfo = {
  id: DevicePreset;
  label: string;
  width: number;
  height: number;
};

/**
 * Presets aligned with Chrome DevTools (portrait for phones/tablets).
 *
 * Source (Chromium): front_end/models/emulation/EmulatedDevices.ts
 * Default subset: entries with `show-by-default: true`.
 */
export const DEVICE_PRESETS: DevicePresetInfo[] = [
  { id: 'iPhoneSE', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'iPhoneXR', label: 'iPhone XR', width: 414, height: 896 },
  { id: 'iPhone12Pro', label: 'iPhone 12 Pro', width: 390, height: 844 },
  { id: 'iPhone14ProMax', label: 'iPhone 14 Pro Max', width: 430, height: 932 },
  { id: 'Pixel7', label: 'Pixel 7', width: 412, height: 915 },
  {
    id: 'SamsungGalaxyS8Plus',
    label: 'Samsung Galaxy S8+',
    width: 360,
    height: 740,
  },
  {
    id: 'SamsungGalaxyS20Ultra',
    label: 'Samsung Galaxy S20 Ultra',
    width: 412,
    height: 915,
  },
  { id: 'iPadMini', label: 'iPad Mini', width: 768, height: 1024 },
  { id: 'iPadAir', label: 'iPad Air', width: 820, height: 1180 },
  { id: 'iPadPro', label: 'iPad Pro', width: 1024, height: 1366 },
  { id: 'SurfacePro7', label: 'Surface Pro 7', width: 912, height: 1368 },
  { id: 'SurfaceDuo', label: 'Surface Duo', width: 540, height: 720 },
  { id: 'GalaxyZFold5', label: 'Galaxy Z Fold 5', width: 344, height: 882 },
  {
    id: 'AsusZenbookFold',
    label: 'Asus Zenbook Fold',
    width: 853,
    height: 1280,
  },
  {
    id: 'SamsungGalaxyA51A71',
    label: 'Samsung Galaxy A51/71',
    width: 412,
    height: 914,
  },
  // Nest Hub devices only expose a single (horizontal) mode in DevTools.
  { id: 'NestHub', label: 'Nest Hub', width: 1024, height: 600 },
  { id: 'NestHubMax', label: 'Nest Hub Max', width: 1280, height: 800 },
];

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

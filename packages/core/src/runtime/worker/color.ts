import { createColors } from 'picocolors';
import { disableDefaultColors, enabledDefaultColors } from 'tinyrainbow';
import { color } from '../../utils/logger';

export function applyRuntimeColors(enabled: boolean): void {
  Object.assign(color, createColors(enabled));
  (enabled ? enabledDefaultColors : disableDefaultColors)();
}

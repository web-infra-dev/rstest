import { parsePercent } from '../utils/format';

export function applyDiscount(total: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new Error(`Discount percent out of range: ${percent}`);
  }
  const ratio = parsePercent(percent);
  return total - total * ratio;
}

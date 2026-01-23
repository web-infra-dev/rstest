export function applyTax(total: number, taxRate: number): number {
  if (taxRate < 0 || taxRate > 1) {
    throw new Error(`Tax rate out of range: ${taxRate}`);
  }
  return total + total * taxRate;
}

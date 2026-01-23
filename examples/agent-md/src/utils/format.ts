export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function parsePercent(value: number): number {
  if (Number.isNaN(value)) {
    throw new Error('Discount percent must be a number');
  }
  return value / 100;
}

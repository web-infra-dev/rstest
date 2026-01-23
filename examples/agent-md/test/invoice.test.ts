import { describe, expect, it } from '@rstest/core';
import { calculateInvoice, type LineItem } from '../src';

describe('invoice service', () => {
  const items: LineItem[] = [
    { name: 'Notebook', unitPrice: 12.5, quantity: 3 },
    { name: 'Pen', unitPrice: 2, quantity: 4 },
    { name: 'Sticker', unitPrice: 1.5, quantity: 2 },
  ];

  it('calculates totals with a discount', () => {
    const summary = calculateInvoice(items, 'WELCOME');
    console.log('[invoice] summary', summary);
    expect(summary.total).toBe(85);
    expect(summary.totalLabel).toBe('$85.00');
  });

  it('rejects unknown discount codes', () => {
    expect(() => calculateInvoice(items, 'UNKNOWN')).toThrow(
      'Discount code missing',
    );
  });
});

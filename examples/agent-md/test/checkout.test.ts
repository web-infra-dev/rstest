import { describe, expect, it } from '@rstest/core';
import { calculateCheckout } from '../src';

describe('checkout flow', () => {
  const items = [
    { name: 'Notebook', unitPrice: 12.5, quantity: 2 },
    { name: 'Marker', unitPrice: 5, quantity: 1 },
    { name: 'Pen', unitPrice: 2.5, quantity: 3 },
  ];

  it('calculates totals with shipping and tax', async () => {
    const summary = await calculateCheckout(items, 10, 'standard', 0.2);
    console.log('[checkout] summary', summary);
    expect(summary.total).toBe(52.8);
  });

  it('rejects unknown shipping option', async () => {
    await expect(
      calculateCheckout(items, 10, 'overnight', 0.08),
    ).rejects.toThrow('Shipping option missing');
  });
});

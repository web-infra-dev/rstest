import { describe, expect, it } from '@rstest/core';
import { calculateInvoice, type LineItem } from '../src';

describe('invoice snapshot', () => {
  const items: LineItem[] = [
    { name: 'Notebook', unitPrice: 12.5, quantity: 3 },
    { name: 'Pen', unitPrice: 2, quantity: 4 },
  ];

  it('renders summary snapshot', () => {
    const summary = calculateInvoice(items, 'WELCOME');
    expect(summary).toMatchInlineSnapshot(`
      {
        "discountPercent": 20,
        "subtotal": 99,
        "total": 79,
        "totalLabel": "$79.00",
      }
    `);
  });
});

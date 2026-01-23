import { findDiscountRule } from '../storage/discounts';
import { formatCurrency } from '../utils/format';
import { applyDiscount } from './discount';

export type LineItem = {
  name: string;
  unitPrice: number;
  quantity: number;
};

export type InvoiceSummary = {
  subtotal: number;
  discountPercent: number;
  total: number;
  totalLabel: string;
};

export function calculateInvoice(
  items: LineItem[],
  discountCode: string,
): InvoiceSummary {
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const { percent } = findDiscountRule(discountCode);
  const total = applyDiscount(subtotal, percent);

  return {
    subtotal,
    discountPercent: percent,
    total,
    totalLabel: formatCurrency(total),
  };
}

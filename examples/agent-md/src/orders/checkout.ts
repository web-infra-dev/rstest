import { applyDiscount } from '../finance/discount';
import type { LineItem } from '../finance/invoice';
import { getShippingOption } from './shipping';
import { applyTax } from './tax';

export type CheckoutSummary = {
  subtotal: number;
  discountPercent: number;
  shippingFee: number;
  taxRate: number;
  total: number;
};

export async function calculateCheckout(
  items: LineItem[],
  discountPercent: number,
  shippingOption: string,
  taxRate: number,
): Promise<CheckoutSummary> {
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const discounted = applyDiscount(subtotal, discountPercent);
  const shipping = getShippingOption(shippingOption);
  const shippingFee = shipping.baseFee + shipping.perItemFee * items.length;
  const totalBeforeTax = discounted + shippingFee;
  const total = applyTax(totalBeforeTax, taxRate);

  return {
    subtotal,
    discountPercent,
    shippingFee,
    taxRate,
    total,
  };
}

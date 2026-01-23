export type DiscountRule = {
  code: string;
  percent: number;
};

const discountRules: DiscountRule[] = [
  { code: 'WELCOME', percent: 10 },
  { code: 'VIP', percent: 15 },
];

export function findDiscountRule(code: string): DiscountRule {
  const normalized = code.trim().toUpperCase();
  const rule = discountRules.find((item) => item.code === normalized);
  if (!rule) {
    throw new Error(`Unknown discount code: ${normalized}`);
  }
  return rule;
}

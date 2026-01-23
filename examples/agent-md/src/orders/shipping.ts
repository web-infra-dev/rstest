export type ShippingOption = {
  name: string;
  baseFee: number;
  perItemFee: number;
};

const options: ShippingOption[] = [
  { name: 'standard', baseFee: 5, perItemFee: 1.2 },
  { name: 'express', baseFee: 15, perItemFee: 2.5 },
];

export function getShippingOption(name: string): ShippingOption {
  const normalized = name.trim().toLowerCase();
  const option = options.find((item) => item.name === normalized);
  if (!option) {
    throw new Error(`Unsupported shipping option: ${normalized}`);
  }
  return option;
}

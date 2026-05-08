export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function product(values: number[]) {
  return values.reduce((total, value) => total * value, 1);
}

// ESM module with default export for testing spy: true
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

const calculator = {
  add,
  subtract,
  name: 'calculator',
};

export default calculator;

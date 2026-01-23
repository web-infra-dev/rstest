// CJS-style module (uses module.exports pattern) for testing spy: true
function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  return a / b;
}

// CommonJS-style exports
export = {
  multiply,
  divide,
};

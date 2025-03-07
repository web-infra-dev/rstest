// TODO: This is a minimal expect API, in order to run the overall process
export class Expectation<T> {
  constructor(private actual: T) {}

  toBe(expected: T): void {
    if (this.actual !== expected) {
      throw new Error(`Expected ${expected} but got ${this.actual}`);
    }
  }
  toBeDefined(): void {
    if (typeof this.actual === 'undefined') {
      throw new Error('Expected defined but got undefined');
    }
  }

  toEqual(expected: T): void {
    const actualStr = JSON.stringify(this.actual);
    const expectedStr = JSON.stringify(expected);

    if (actualStr !== expectedStr) {
      throw new Error(`Expected ${expectedStr} but got ${actualStr}`);
    }
  }

  toBeGreaterThan(expected: number): void {
    if (typeof this.actual !== 'number') {
      throw new Error('Actual value must be a number');
    }
    if (this.actual <= expected) {
      throw new Error(`Expected ${this.actual} to be greater than ${expected}`);
    }
  }

  toBeTruthy(): void {
    if (!this.actual) {
      throw new Error(`Expected ${this.actual} to be truthy`);
    }
  }
}

export function expect<T>(actual: T): Expectation<T> {
  return new Expectation(actual);
}

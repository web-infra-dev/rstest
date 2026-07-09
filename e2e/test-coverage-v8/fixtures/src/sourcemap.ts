// Use enum to ensure the compiled JS has different line mapping from the original TS source.
export enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

export class Calculator {
  public base = 10;

  constructor(public factor: number) {}

  add(val: number) {
    if (val > 0) {
      return this.base + val * this.factor;
    }
    return this.base;
  }
}

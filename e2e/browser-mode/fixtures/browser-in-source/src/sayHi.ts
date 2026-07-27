export const sayHi = (): string => 'hi';

if (import.meta.rstest) {
  const { it, expect } = import.meta.rstest;
  it('runs the in-source test in the browser', () => {
    expect(sayHi()).toBe('hi');
    expect(typeof document).toBe('object');
  });
}

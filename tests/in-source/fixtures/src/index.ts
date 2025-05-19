export const sayHi = () => 'hi';

if (import.meta.rstest) {
  const { it, expect } = import.meta.rstest;
  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });
}

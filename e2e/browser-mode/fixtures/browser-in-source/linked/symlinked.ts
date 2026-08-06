export const linkedValue = 'linked';

if (import.meta.rstest) {
  const { expect, it } = import.meta.rstest;
  it('runs a symlinked in-source test in the browser', () => {
    expect(linkedValue).toBe('linked');
    expect(typeof document).toBe('object');
  });
}

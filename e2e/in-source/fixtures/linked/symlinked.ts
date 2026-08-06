export const linkedValue = 'linked';

if (import.meta.rstest) {
  const { expect, it } = import.meta.rstest;
  it('runs an in-source test discovered through a symlink', () => {
    expect(linkedValue).toBe('linked');
  });
}

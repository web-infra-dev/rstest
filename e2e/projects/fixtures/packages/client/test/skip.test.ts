it('should pass', () => {
  expect(1).toBe(1);
});

it.skip('should be skipped in client', () => {
  expect(1).toBe(2);
});

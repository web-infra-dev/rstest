rs.mock('./answer.cjs', () => ({ answer: () => 42 }));

it('loads the mocked CJS module through require', () => {
  expect(require('./answer.cjs').answer()).toBe(42);
});

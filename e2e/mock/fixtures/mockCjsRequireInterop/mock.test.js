rs.mock('./answer.cjs', () => ({ answer: () => 42 }));

it('loads the mocked CJS module through require', () => {
  expect(require('./answer.cjs').answer()).toBe(42);
});

it('spies on and restores an export of the mocked CJS module', () => {
  const mod = require('./answer.cjs');
  const spy = rs.spyOn(mod, 'answer').mockReturnValue(7);
  expect(mod.answer()).toBe(7);

  spy.mockRestore();
  expect(mod.answer()).toBe(42);
});

rs.mock('./answer.cjs', () => ({ answer: () => 42 }));

it('loads the mocked CJS module through require', () => {
  expect(require('./answer.cjs').answer()).toBe(42);
});

it('spies on a plain factory export and restores the factory implementation', () => {
  const mod = require('./answer.cjs');
  const original = mod.answer;
  expect(rs.isMockFunction(original)).toBe(false);

  const spy = rs.spyOn(mod, 'answer').mockReturnValue(43);
  expect(mod.answer()).toBe(43);
  expect(spy).toHaveBeenCalledTimes(1);

  spy.mockRestore();
  expect(mod.answer).toBe(original);
  expect(mod.answer()).toBe(42);
});

it('spies on the synthetic default getter and restores the factory object', () => {
  const mod = require('./answer.cjs');
  const original = mod.default;
  expect(original.answer()).toBe(42);

  const replacement = { answer: () => 43 };
  const spy = rs.spyOn(mod, 'default', 'get').mockReturnValue(replacement);
  expect(mod.default).toBe(replacement);
  expect(spy).toHaveBeenCalledTimes(1);

  spy.mockRestore();
  expect(mod.default).toBe(original);
  expect(mod.default.answer()).toBe(42);
});

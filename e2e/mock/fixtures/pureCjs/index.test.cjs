it('mocked cjs with named exports', () => {
  rs.doMockRequire('./namedExports.js', () => ({ greeting: 'hello' }));
  const e = require('./namedExports.js');
  expect(e.greeting).toBe('hello');
});

it.todo('mocked cjs with default export', () => {
  rs.doMockRequire('./defaultExport.js', () => () => 'hello');
  const e = require('./defaultExport.js');
  expect(e()).toBe('hello');
});

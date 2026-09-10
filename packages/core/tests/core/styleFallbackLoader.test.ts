// @ts-expect-error Runtime loaders are shipped as JavaScript without declarations.
import * as loader from '../../src/core/plugins/styleFallbackLoader.mjs';

it.each([
  ['style.less', 'module.exports = "";'],
  ['style.scss', 'module.exports = "";'],
  ['style.sass', 'module.exports = "";'],
  ['style.module.less', 'module.exports = {};'],
  ['style.module.scss', 'module.exports = {};'],
  ['style.module.sass', 'module.exports = {};'],
])(
  'returns the empty export for %s without reading its content',
  (resourcePath, expected) => {
    expect(
      loader.pitch.call({
        loaders: [{}],
        _module: { type: 'javascript/auto' },
        resourcePath,
      }),
    ).toBe(expected);
  },
);

it.each([
  { loaders: [{}, {}], type: 'javascript/auto' },
  { loaders: [{}], type: 'asset/source' },
  { loaders: [{}], type: 'css/module' },
  { loaders: [{}], type: 'javascript/esm' },
])('preserves handled resources: %j', ({ loaders, type }) => {
  expect(loader.pitch.call({ loaders, _module: { type } })).toBeUndefined();
});

it('preserves handled resource bytes, source maps and loader metadata', () => {
  const source = Buffer.from([0, 255, 128]);
  const sourceMap = { version: 3, sources: ['style.less'], mappings: '' };
  const meta = { custom: true };
  const callback = rs.fn();
  expect(loader.raw).toBe(true);
  loader.default.call({ callback }, source, sourceMap, meta);
  expect(callback).toHaveBeenCalledWith(null, source, sourceMap, meta);
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { withTempDir } from '../../../helpers/tempDir';
import {
  getExternalModuleFormat,
  parseExternalDataUri,
} from '../../../../src/runtime/worker/vm/externalModuleCache';

describe('parseExternalDataUri', () => {
  it('accepts Node JavaScript MIME aliases and case-insensitive parameters', () => {
    expect(
      parseExternalDataUri(
        'data:application/javascript;charset=UTF-8,export%20default%201',
      ),
    ).toEqual({ code: 'export default 1', mime: 'text/javascript' });
  });

  it.each(['', 'export default 1', 'export default 12', 'export default 123'])(
    'accepts optional base64 padding: %s',
    (source) => {
      const encoded = Buffer.from(source).toString('base64');
      for (const payload of [encoded, encoded.replace(/=+$/, '')]) {
        expect(
          parseExternalDataUri(`data:TEXT/JAVASCRIPT;BASE64,${payload}`),
        ).toEqual({
          code: source,
          mime: 'text/javascript',
        });
      }
    },
  );

  it('accepts percent-encoded whitespace around base64 without padding', () => {
    const encoded = Buffer.from('export default 1')
      .toString('base64')
      .replace(/=+$/, '');
    expect(
      parseExternalDataUri(
        `data:text/javascript;base64,%09${encoded}%0A%0D%0C%20`,
      ),
    ).toEqual({
      code: 'export default 1',
      mime: 'text/javascript',
    });
  });

  it('does not treat non-terminal base64 parameters as an encoding marker', () => {
    expect(
      parseExternalDataUri(
        'data:text/javascript;base64;charset=UTF-8,export%20default%201',
      ),
    ).toEqual({
      code: 'export default 1',
      mime: 'text/javascript',
    });
  });

  it.each([
    'A',
    'AAAAA',
    'AA=',
    'AAA==',
    'AAAA=',
    '=AAA',
    'AA=A',
    'AA===',
    'AA!',
    'AA_',
    'AA-',
    '%',
    '%FF',
    'AA%0B',
  ])('rejects malformed base64 data URLs: %s', (payload) => {
    expect(() =>
      parseExternalDataUri(`data:text/javascript;base64,${payload}`),
    ).toThrow(expect.objectContaining({ code: 'ERR_INVALID_URL' }));
  });

  it('accepts data URL parameters supported by Node', () => {
    expect(
      parseExternalDataUri(
        'data:text/javascript;charset=iso-8859-1;foo=bar,export default 1',
      ),
    ).toEqual({
      code: 'export default 1',
      mime: 'text/javascript',
    });
  });

  it('ignores data URL fragments when decoding the payload', () => {
    expect(
      parseExternalDataUri('data:text/javascript,export%20default%201#v1'),
    ).toEqual({ code: 'export default 1', mime: 'text/javascript' });
  });
});

it('accepts a BOM-prefixed package.json when resolving JavaScript format', async () => {
  await withTempDir('rstest-vm-package-', (directory) => {
    writeFileSync(join(directory, 'package.json'), '\uFEFF{"type":"module"}');

    expect(
      getExternalModuleFormat(pathToFileURL(join(directory, 'value.js')).href),
    ).toBe('module');
  });
});

it('does not inherit package type through node_modules', async () => {
  await withTempDir('rstest-vm-package-boundary-', (directory) => {
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    expect(getExternalModuleFormat(join(directory, 'app.js'))).toBe('module');
    for (const name of ['legacy', '@scope/legacy']) {
      const dependency = join(directory, 'node_modules', name);
      mkdirSync(dependency, { recursive: true });
      expect(getExternalModuleFormat(join(dependency, 'index.js'))).toBe(
        'commonjs',
      );
      expect(
        getExternalModuleFormat(join(dependency, 'index.js'), 'require'),
      ).toBe('commonjs');
    }
  });
});

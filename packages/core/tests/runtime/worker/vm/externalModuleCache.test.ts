import { describe, expect, it } from '@rstest/core';
import { parseExternalDataUri } from '../../../../src/runtime/worker/vm/externalModuleCache';

describe('parseExternalDataUri', () => {
  it('accepts Node JavaScript MIME aliases and case-insensitive parameters', () => {
    expect(
      parseExternalDataUri(
        'data:application/javascript;charset=UTF-8,export%20default%201',
      ),
    ).toEqual({ code: 'export default 1', mime: 'text/javascript' });
  });

  it('accepts base64 JavaScript data URLs', () => {
    expect(
      parseExternalDataUri('data:TEXT/JAVASCRIPT;BASE64,Y29uc3QgdmFsdWUgPSAx'),
    ).toEqual({ code: 'const value = 1', mime: 'text/javascript' });
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
});

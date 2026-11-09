import { inspect } from 'node:util';
import { expect, test, rs } from '@rstest/core';

test('silent skips formatting and keeps console methods mockable', () => {
  const customInspect = rs.fn(() => 'formatted-console-value');
  const value = { [inspect.custom]: customInspect };
  const log = rs.spyOn(console, 'log');
  console.log(value);
  console.info(value);
  console.warn(value);
  console.error(value);
  console.debug(value);
  console.dirxml(value);
  console.group(value);
  console.groupCollapsed(value);
  console.groupEnd();
  console.groupEnd();
  console.time('silent');
  console.timeLog('silent', value);
  console.timeEnd('silent');
  console.trace(value);
  console.table(value);
  console.assert(false, 'suppressed assertion');

  expect(log).toHaveBeenCalledWith(value);
  if (process.env.RSTEST_EXPECT_SILENT === 'true') {
    expect(customInspect).not.toHaveBeenCalled();
  } else {
    expect(customInspect).toHaveBeenCalled();
  }
});

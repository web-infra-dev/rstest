import { expect, it } from '@rstest/core';
import { formatUnsupportedCoreVersionMessage } from '../../src/versionCheck';

it('should explain both supported migration paths', () => {
  const message = formatUnsupportedCoreVersionMessage('0.11.9');
  expect(message).toContain('@rstest/core >= 0.12.0');
  expect(message).toContain('Upgrade @rstest/core to >= 0.12.0');
  expect(message).toContain(
    'install an older version of the Rstest extension in VS Code',
  );
});

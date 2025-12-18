import { describe, expect, it } from '@rstest/core';

describe('browser snapshot - file', () => {
  it('should match file snapshot', async () => {
    const data = { key: 'value', count: 42 };
    await expect(JSON.stringify(data, null, 2)).toMatchFileSnapshot(
      '__file_snapshots__/data.json',
    );
  });
});

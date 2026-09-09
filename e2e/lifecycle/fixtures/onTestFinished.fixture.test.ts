import { expect, test as base } from '@rstest/core';

const test = base.extend<{ resource: { open: boolean } }>({
  resource: async (_, use) => {
    const resource = { open: true };
    await use(resource);
    expect(resource.open).toBe(true);
    console.log('[fixture] teardown');
  },
});

test('fixture teardown precedes onTestFinished', ({
  onTestFinished,
  resource,
}) => {
  onTestFinished(() => {
    console.log('[onTestFinished] cleanup');
    resource.open = false;
  });
});

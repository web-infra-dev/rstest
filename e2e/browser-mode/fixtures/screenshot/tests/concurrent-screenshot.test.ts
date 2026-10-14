import { page } from '@rstest/browser';
import { test } from '@rstest/core';

test.concurrent(
  'uses the pinned test context with the test-scoped expect',
  async ({ expect }) => {
    document.body.innerHTML = '<button>Concurrent screenshot</button>';
    await expect(
      page.getByRole('button', { name: 'Concurrent screenshot' }),
    ).toMatchScreenshot();
  },
);

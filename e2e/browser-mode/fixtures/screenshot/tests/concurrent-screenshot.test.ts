import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

test.concurrent(
  'uses the active task deadline with shared expect',
  async () => {
    setTimeout(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<button>Shared concurrent screenshot</button>',
      );
    }, 1200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      page.getByRole('button', {
        name: 'Shared concurrent screenshot',
        exact: true,
      }),
    ).toMatchScreenshot('shared-concurrent-screenshot', {
      stabilityTimeout: 0,
    });
  },
  5000,
);

test.concurrent(
  'finishes while another concurrent screenshot is waiting',
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  },
  1000,
);

test.concurrent(
  'uses the pinned test context with the test-scoped expect',
  async ({ expect }) => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button>Concurrent screenshot</button>',
    );
    await expect(
      page.getByRole('button', {
        name: 'Concurrent screenshot',
        exact: true,
      }),
    ).toMatchScreenshot();
  },
);

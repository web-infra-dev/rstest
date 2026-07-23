import { afterEach, test } from '@rstest/core';

const failingTest = test.extend<{ failing: string }>({
  failing: async () => {
    throw new Error('fixture setup failed');
  },
});

afterEach(() => {
  console.log('later afterEach ran');
});

afterEach<{ failing: string }>(({ failing }) => {
  console.log(failing);
});

failingTest('fails during fixture setup', ({ failing }) => {
  console.log(failing);
});

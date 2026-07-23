import { afterEach, describe, test } from '@rstest/core';

describe('failed test fixture', () => {
  const failingTest = test.extend<{ failing: string }>({
    failing: async () => {
      throw new Error('test fixture setup failed');
    },
  });

  afterEach(() => {
    console.log('later afterEach ran after test fixture failure');
  });

  afterEach<{ failing: string }>(({ failing }) => {
    console.log(failing);
  });

  failingTest('fails during fixture setup', ({ failing }) => {
    console.log(failing);
  });
});

describe('failed afterEach fixture', () => {
  const failingTest = test.extend<{ failing: string }>({
    failing: async () => {
      throw new Error('afterEach fixture setup failed');
    },
  });

  afterEach(() => {
    console.log('later afterEach ran after afterEach fixture failure');
  });

  afterEach<{ failing: string }>(({ failing }) => {
    console.log(failing);
  });

  failingTest('fails during afterEach fixture setup', () => {});
});

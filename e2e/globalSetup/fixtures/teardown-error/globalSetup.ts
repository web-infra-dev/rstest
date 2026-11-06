import { runInNewContext } from 'node:vm';

export default async function globalSetup() {
  return () => {
    if (process.env.RSTEST_FOREIGN_TEARDOWN === 'true') {
      throw runInNewContext(
        'new TypeError("Global teardown failed intentionally")',
        {},
        {
          filename: 'foreign-teardown.js',
        },
      );
    }
    throw new Error('Global teardown failed intentionally');
  };
}

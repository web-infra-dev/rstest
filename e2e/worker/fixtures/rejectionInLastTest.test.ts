import { it } from '@rstest/core';

// The file's last test. Node reports the rejection only once the microtask
// queue drains, which is after the runner has finished the file.
it('leaves a rejected promise without a handler', () => {
  Promise.reject(new Error('LAST_TEST_REJECTION'));
});

import { rs } from '@rstest/core';
import { state, secondStarted } from './sequence-state';

rs.mock('./sequence-target', () => ({ value: 'mocked' }));

if (process.env.SETUP_FAILURE) {
  throw new Error('FIRST_SETUP_FAILURE');
}

if (process.env.SETUP_SEQUENCE === 'parallel') {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      secondStarted,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('SETUPS_DID_NOT_OVERLAP')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
} else {
  await Promise.resolve();
}
state.firstFinished = true;

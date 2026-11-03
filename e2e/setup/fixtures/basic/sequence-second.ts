import { signalSecond, state } from './sequence-state';

state.overlap = !state.firstFinished;
signalSecond();
await Promise.resolve();
state.secondFinished = true;

if (process.env.SETUP_FAILURE) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log('SECOND_SETUP_DRAINED');
  if (process.env.SETUP_FAILURE === 'multiple') {
    throw new Error('SECOND_SETUP_FAILURE');
  }
}

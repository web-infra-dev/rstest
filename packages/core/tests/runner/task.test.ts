import { wrapTimeout } from '../../src/runtime/runner/task';
import { setRealTimers } from '../../src/runtime/util';

describe('wrapTimeout', () => {
  it('passes the rejected timeout error to onTimeout', async () => {
    setRealTimers();
    let timeoutError: Error | undefined;
    const run = wrapTimeout({
      name: 'test',
      fn: () => new Promise(() => {}),
      timeout: 10,
      onTimeout: (error) => {
        timeoutError = error;
      },
      stackTraceError: new Error('stack'),
    });

    let rejectedError: unknown;
    try {
      await run();
    } catch (error) {
      rejectedError = error;
    }

    expect(timeoutError).toBeInstanceOf(Error);
    expect(timeoutError).toBe(rejectedError);
    expect(timeoutError?.message).toBe('test timed out in 10ms');
  });
});

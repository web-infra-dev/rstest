import { describe, expect, it, registerFileCleanup } from '@rstest/core';

const teardownError = process.env.RSTEST_VM_TEARDOWN_ERROR;
if (teardownError) {
  it('finishes the test before the injected teardown error', () => {});
  registerFileCleanup(() => {
    const onRemoved = (event: string | symbol) => {
      if (event !== 'uncaughtException') return;
      process.off('removeListener', onRemoved);
      // Inject at the actual handler handoff, without relying on an I/O race.
      process.emit('uncaughtException', new Error('VM_TEARDOWN_UNCAUGHT'));
    };
    process.on('removeListener', onRemoved);
  });
}

describe.skipIf(Boolean(teardownError))('Index', () => {
  it('should add two numbers correctly', async () => {
    setTimeout(() => {
      expect('hello').toBe('hii');
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(1 + 1).toBe(2);
  });
});

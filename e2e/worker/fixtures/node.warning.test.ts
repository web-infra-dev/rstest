import { describe, expect, it } from '@rstest/core';

describe('Index', () => {
  it('should add two numbers correctly', () => {
    // Trigger a Node warning at runtime (instead of module evaluation) so the
    // e2e harness has already attached stdout/stderr listeners.
    // This keeps the test intention (warnings are forwarded) while avoiding
    // flakiness from very early stderr output.
    const { EventEmitter } =
      require('node:events') as typeof import('node:events');
    const eventEmitter = new EventEmitter();

    for (let i = 0; i < 11; i++) {
      eventEmitter.on('test-event', () => {});
    }

    expect(1 + 1).toBe(2);
  });
});

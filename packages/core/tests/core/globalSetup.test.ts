import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from '@rstest/core';
import { GlobalSetupWorker } from '../../src/core/globalSetup';

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  sendCallback: ((error: Error | null) => void) | undefined;

  send(_message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sendCallback = callback;
    return true;
  }
}

const createWorker = (child: MockChildProcess): GlobalSetupWorker =>
  new GlobalSetupWorker(() => child as unknown as ChildProcess);

describe('GlobalSetupWorker', () => {
  it('should reject when IPC send reports an error', async () => {
    const child = new MockChildProcess();
    const worker = createWorker(child);
    const promise = worker.call({ type: 'teardown' });

    expect(child.sendCallback).toBeTypeOf('function');
    child.sendCallback!(new Error('send failed'));

    await expect(promise).rejects.toThrow('send failed');
  });

  it('should reject pending calls when worker emits an error', async () => {
    const child = new MockChildProcess();
    const worker = createWorker(child);
    const promise = worker.call({ type: 'teardown' });

    child.emit('error', new Error('worker error'));

    await expect(promise).rejects.toThrow('worker error');
  });
});

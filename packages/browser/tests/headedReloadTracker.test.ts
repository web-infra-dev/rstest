import { describe, expect, it } from '@rstest/core';
import { createHeadedReloadTracker } from '../src/headedReloadTracker';

const settled = async (
  promise: Promise<void>,
): Promise<'pending' | 'resolved' | 'rejected'> => {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  promise.then(
    () => {
      state = 'resolved';
    },
    () => {
      state = 'rejected';
    },
  );
  // A macrotask, so every already-settled promise's reactions have drained.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return state;
};

describe('headed reload tracker', () => {
  it('should settle a registration through resolve with a matching runId', async () => {
    const tracker = createHeadedReloadTracker(() => true);
    const reload = tracker.register('/a.test.ts', 'run-1');

    tracker.resolve('/a.test.ts', 'run-2');
    expect(await settled(reload)).toBe('pending');

    tracker.resolve('/a.test.ts', 'run-1');
    expect(await settled(reload)).toBe('resolved');
  });

  it('should resolve immediately without tracking when the file is not live', async () => {
    const tracker = createHeadedReloadTracker(
      (testPath) => testPath !== '/gone.test.ts',
    );
    const reload = tracker.register('/gone.test.ts', 'run-1');
    expect(await settled(reload)).toBe('resolved');

    // Nothing was tracked, so a later completion for the path is a no-op.
    tracker.resolve('/gone.test.ts', 'run-1');
  });

  it('should reject a superseded registration and keep the newer one', async () => {
    const tracker = createHeadedReloadTracker(() => true);
    const first = tracker.register('/a.test.ts', 'run-1');
    const second = tracker.register('/a.test.ts', 'run-2');

    await expect(first).rejects.toThrow('superseded by a newer request');
    expect(await settled(second)).toBe('pending');

    tracker.resolve('/a.test.ts', 'run-2');
    expect(await settled(second)).toBe('resolved');
  });

  it('should reject only on a matching runId and reject everything on rejectAll', async () => {
    const tracker = createHeadedReloadTracker(() => true);
    const a = tracker.register('/a.test.ts', 'run-1');
    const b = tracker.register('/b.test.ts', 'run-2');

    tracker.reject('/a.test.ts', new Error('stale'), 'run-9');
    expect(await settled(a)).toBe('pending');

    tracker.rejectAll(new Error('disconnected'));
    await expect(a).rejects.toThrow('disconnected');
    await expect(b).rejects.toThrow('disconnected');
  });

  it('should reconcile pending reloads whose file left the live set and spare live ones', async () => {
    const live = new Set(['/a.test.ts', '/b.test.ts']);
    const tracker = createHeadedReloadTracker((testPath) => live.has(testPath));
    const kept = tracker.register('/a.test.ts', 'run-1');
    const dropped = tracker.register('/b.test.ts', 'run-2');

    live.delete('/b.test.ts');
    tracker.reconcile();

    expect(await settled(dropped)).toBe('resolved');
    expect(await settled(kept)).toBe('pending');
  });

  it('should leave a claimed completion to its handler across reconcile', async () => {
    const live = new Set(['/a.test.ts']);
    const tracker = createHeadedReloadTracker((testPath) => live.has(testPath));
    const reload = tracker.register('/a.test.ts', 'run-1');

    // The completion arrived and its handler is running; the file is deleted
    // mid-handler. Reconcile must not settle what the handler will.
    tracker.claimCompletion('/a.test.ts', 'run-1');
    live.delete('/a.test.ts');
    tracker.reconcile();
    expect(await settled(reload)).toBe('pending');

    tracker.resolve('/a.test.ts', 'run-1');
    expect(await settled(reload)).toBe('resolved');
  });

  it('should not let a superseded run claim the pending', async () => {
    const live = new Set(['/a.test.ts']);
    const tracker = createHeadedReloadTracker((testPath) => live.has(testPath));
    const reload = tracker.register('/a.test.ts', 'run-2');

    // A stale completion claims nothing, so the pending stays reconcilable.
    tracker.claimCompletion('/a.test.ts', 'run-1');
    live.delete('/a.test.ts');
    tracker.reconcile();

    expect(await settled(reload)).toBe('resolved');
  });
});

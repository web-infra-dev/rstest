import { describe, expect, it } from '@rstest/core';
import { createHeadedRunRegistry } from '../src/headedRunRegistry';

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

describe('headed run registry', () => {
  it('should resolve a run through claim + resolve and drop the identity', async () => {
    const runs = createHeadedRunRegistry();
    const { runId, settled: run } = runs.mint('/a.test.ts');

    expect(runs.has(runId)).toBe(true);
    expect(runs.claim(runId)).toBe(true);
    runs.resolve(runId);

    expect(await settled(run)).toBe('resolved');
    expect(runs.has(runId)).toBe(false);
  });

  it('should refuse a second claim — a duplicate terminal message is stale', async () => {
    const runs = createHeadedRunRegistry();
    const { runId } = runs.mint('/a.test.ts');

    expect(runs.claim(runId)).toBe(true);
    expect(runs.claim(runId)).toBe(false);
    expect(runs.claim('unknown-run')).toBe(false);
  });

  it('should close open runs whose path left the set and spare the rest', async () => {
    const runs = createHeadedRunRegistry();
    const dropped = runs.mint('/gone.test.ts');
    const kept = runs.mint('/kept.test.ts');

    runs.retainPaths(['/kept.test.ts']);

    expect(await settled(dropped.settled)).toBe('resolved');
    expect(await settled(kept.settled)).toBe('pending');
    // The closed run's identity is gone: a completion already in transport
    // finds no run to attach to and drops by rule.
    expect(runs.has(dropped.runId)).toBe(false);
  });

  it('should leave a claimed run to its handler across retainPaths', async () => {
    const runs = createHeadedRunRegistry();
    const { runId, settled: run } = runs.mint('/a.test.ts');

    runs.claim(runId);
    runs.retainPaths([]);
    expect(await settled(run)).toBe('pending');

    runs.resolve(runId);
    expect(await settled(run)).toBe('resolved');
  });

  it('should make delete-then-re-add two distinct identities', async () => {
    const runs = createHeadedRunRegistry();
    const first = runs.mint('/a.test.ts');
    runs.retainPaths([]);
    expect(await settled(first.settled)).toBe('resolved');

    // The path comes back: a NEW run, and the old identity stays dead even
    // though the path is live again (the ABA the path-keyed guard missed).
    const second = runs.mint('/a.test.ts');
    expect(first.runId).not.toBe(second.runId);
    expect(runs.has(first.runId)).toBe(false);
    expect(runs.claim(first.runId)).toBe(false);
    expect(runs.claim(second.runId)).toBe(true);
  });

  it('should close an open predecessor when the same path is minted again', async () => {
    const runs = createHeadedRunRegistry();
    const first = runs.mint('/a.test.ts');
    const second = runs.mint('/a.test.ts');

    expect(await settled(first.settled)).toBe('resolved');
    expect(await settled(second.settled)).toBe('pending');

    // A claimed predecessor is the handler's; a new mint must not settle it.
    runs.claim(second.runId);
    const third = runs.mint('/a.test.ts');
    expect(await settled(second.settled)).toBe('pending');
    runs.resolve(second.runId);
    expect(await settled(second.settled)).toBe('resolved');
    expect(await settled(third.settled)).toBe('pending');
  });

  it('should reject only open runs on rejectAll and spare claimed ones', async () => {
    const runs = createHeadedRunRegistry();
    const open = runs.mint('/open.test.ts');
    const claimed = runs.mint('/claimed.test.ts');
    runs.claim(claimed.runId);

    runs.rejectAll(new Error('disconnected'));

    await expect(open.settled).rejects.toThrow('disconnected');
    expect(await settled(claimed.settled)).toBe('pending');
    runs.resolve(claimed.runId);
    expect(await settled(claimed.settled)).toBe('resolved');
  });

  it('should close runs from an older transport epoch, even without a close event', async () => {
    const runs = createHeadedRunRegistry();
    runs.setTransportEpoch(1);
    const before = runs.mint('/a.test.ts');

    runs.setTransportEpoch(2);
    await expect(before.settled).rejects.toThrow('transport was replaced');

    const after = runs.mint('/a.test.ts');
    runs.setTransportEpoch(2);
    expect(await settled(after.settled)).toBe('pending');
  });

  it('should settle every run exactly once, first transition wins', async () => {
    // A2 as a property of the machine: for each pair of settlers, applying
    // both in either order settles once with the FIRST one's outcome.
    type Settler = {
      name: string;
      apply: (
        runs: ReturnType<typeof createHeadedRunRegistry>,
        runId: string,
      ) => void;
      outcome: 'resolved' | 'rejected';
    };
    const settlers: Settler[] = [
      {
        name: 'resolve',
        apply: (runs, id) => runs.resolve(id),
        outcome: 'resolved',
      },
      {
        name: 'reject',
        apply: (runs, id) => runs.reject(id, new Error('x')),
        outcome: 'rejected',
      },
      {
        name: 'retainPaths',
        apply: (runs) => runs.retainPaths([]),
        outcome: 'resolved',
      },
      {
        name: 'rejectAll',
        apply: (runs) => runs.rejectAll(new Error('x')),
        outcome: 'rejected',
      },
    ];

    for (const first of settlers) {
      for (const second of settlers) {
        const runs = createHeadedRunRegistry();
        const { runId, settled: run } = runs.mint('/a.test.ts');
        first.apply(runs, runId);
        second.apply(runs, runId);
        expect
          .soft(await settled(run), `${first.name} then ${second.name}`)
          .toBe(first.outcome);
      }
    }
  });
});

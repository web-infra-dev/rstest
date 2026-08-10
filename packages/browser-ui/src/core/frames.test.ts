import { describe, expect, it } from '@rstest/core';
import { createFrameLeaseTable } from './frames';

describe('frame lease table', () => {
  it('should replace the lease and bump boot on every grant', () => {
    const leases = createFrameLeaseTable();

    const first = leases.grant('/a.test.ts', 'run-1');
    const second = leases.grant('/a.test.ts', 'run-2', 'my pattern');

    expect(second.boot).toBeGreaterThan(first.boot);
    expect(leases.get('/a.test.ts')).toEqual(second);
    expect(leases.get('/a.test.ts')?.testNamePattern).toBe('my pattern');
  });

  it('should return the current lease synchronously after grant', () => {
    // The HMR re-stamp invariant, isolated: whatever document boots after a
    // grant must read the granted identity — there is no commit to wait for.
    const leases = createFrameLeaseTable();
    leases.grant('/a.test.ts', 'run-1');
    expect(leases.get('/a.test.ts')?.runId).toBe('run-1');
  });

  it('should leave a dropped frame leaseless — a booting document stays silent', () => {
    const leases = createFrameLeaseTable();
    leases.grant('/kept.test.ts', 'run-1');
    leases.grant('/gone.test.ts', 'run-2');

    leases.retain(['/kept.test.ts']);

    expect(leases.get('/kept.test.ts')?.runId).toBe('run-1');
    expect(leases.get('/gone.test.ts')).toBeUndefined();
  });

  it('should not revive a lease when a path is re-added', () => {
    const leases = createFrameLeaseTable();
    const first = leases.grant('/a.test.ts', 'run-1');
    leases.retain([]);

    // Re-added path starts leaseless; a fresh grant is a fresh boot.
    expect(leases.get('/a.test.ts')).toBeUndefined();
    const second = leases.grant('/a.test.ts', 'run-2');
    expect(second.boot).toBeGreaterThan(first.boot);
  });
});

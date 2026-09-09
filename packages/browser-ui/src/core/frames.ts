/**
 * Per-frame run leases — the container's half of headed run identity.
 *
 * The host mints a run and grants it here (synchronously, before anything
 * renders or navigates); whatever document boots into the frame afterwards is
 * conferred the lease over the config handshake. Identity is never read back
 * from the DOM, the frame URL, or React state: an HMR full reload boots a new
 * document into the same frame, and the lease — not the document's own URL —
 * is what names the run the host is awaiting NOW.
 *
 * `boot` is a monotonic mount counter: the iframe's React key encodes it, so
 * every grant mounts a fresh browsing context and a run can never be serviced
 * by a document the previous run left behind. It carries no identity.
 */
export type FrameLease = {
  runId: string;
  boot: number;
  testNamePattern?: string;
};

export const createFrameLeaseTable = () => {
  const leases = new Map<string, FrameLease>();
  let bootCounter = 0;

  return {
    /** Replace the frame's lease; the previous run (if any) is simply gone. */
    grant(
      testPath: string,
      runId: string,
      testNamePattern?: string,
    ): FrameLease {
      bootCounter += 1;
      const lease: FrameLease = { runId, boot: bootCounter, testNamePattern };
      leases.set(testPath, lease);
      return lease;
    },

    get(testPath: string): FrameLease | undefined {
      return leases.get(testPath);
    },

    /**
     * Drop leases whose path left the committed file set. A re-added path
     * starts leaseless — no revival, no ABA.
     */
    retain(paths: readonly string[]): void {
      const retained = new Set(paths);
      for (const testPath of leases.keys()) {
        if (!retained.has(testPath)) {
          leases.delete(testPath);
        }
      }
    },
  };
};

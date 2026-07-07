// Each time this setup file runs it bumps a per-worker counter. If `extends`
// were applied twice (duplicating this entry in `setupFiles`), the file would
// be listed — and executed — twice, and the counter would read 2.
const g = globalThis as { __SETUP_COUNT__?: number };
g.__SETUP_COUNT__ = (g.__SETUP_COUNT__ ?? 0) + 1;

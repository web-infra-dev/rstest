import os from 'node:os';

/**
 * Parse a user-supplied `pool.memoryLimit` value into a byte count.
 *
 * Returns `0` when:
 * - input is `undefined`, `null`, or non-positive
 * - the string cannot be interpreted (caller may want to log/warn
 *   separately; here we just disable the cap rather than crashing CI)
 *
 * Accepted forms (mirrors Vitest's `VmOptions.memoryLimit`):
 * - `number >= 1` — interpreted as bytes
 * - `number` in `(0, 1]` — fraction of total system memory
 * - `string` with a unit suffix — case-insensitive:
 *   - `kb`/`k` (1e3), `kib` (2^10)
 *   - `mb`/`m` (1e6), `mib` (2^20)
 *   - `gb`/`g` (1e9), `gib` (2^30)
 *   - `%` — fraction of total system memory (e.g. `"20%"`)
 * - `string` without a unit suffix — parsed as a number (same rules as
 *   the number form above)
 */
export const parseMemoryLimit = (
  input: number | string | undefined,
): number => {
  if (input === undefined || input === null) return 0;

  const totalMemory = os.totalmem();

  if (typeof input === 'string') {
    // Pull a trailing unit suffix off (e.g. "1.5GB" → "1.5" + "GB").
    const match = input.trim().match(/^(-?\d+(?:\.\d+)?)\s*([a-z%]+)?$/i);
    if (!match) return 0;
    const numeric = Number.parseFloat(match[1]!);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    const unit = (match[2] ?? '').toLowerCase();

    switch (unit) {
      case '':
        return fromNumber(numeric, totalMemory);
      case '%':
        return Math.floor((numeric / 100) * totalMemory);
      case 'k':
      case 'kb':
        return Math.floor(numeric * 1e3);
      case 'kib':
        return Math.floor(numeric * 1024);
      case 'm':
      case 'mb':
        return Math.floor(numeric * 1e6);
      case 'mib':
        return Math.floor(numeric * 1024 * 1024);
      case 'g':
      case 'gb':
        return Math.floor(numeric * 1e9);
      case 'gib':
        return Math.floor(numeric * 1024 * 1024 * 1024);
      default:
        return 0;
    }
  }

  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return 0;
  }
  return fromNumber(input, totalMemory);
};

const fromNumber = (value: number, totalMemory: number): number => {
  // `(0, 1]` → fraction of system memory; `> 1` → bytes verbatim.
  if (value <= 1) return Math.floor(value * totalMemory);
  return Math.floor(value);
};

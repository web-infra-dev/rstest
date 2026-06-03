/**
 * Wire-format codec for serializing a `RegExp` `testNamePattern` across the
 * pool / browser-host boundary.
 *
 * The encoder ({@link wrapRegex}) and decoder ({@link unwrapRegex}) are the
 * single owner of the `RSTEST_REGEXP:` sentinel and its flag grammar, so the two
 * ends can never drift. This module is intentionally free of Node-only imports
 * so it can be re-exported from the browser-runtime surface
 * (`@rstest/core/internal/browser-runtime`) and bundled into the browser client.
 */
const REGEXP_FLAG_PREFIX = 'RSTEST_REGEXP:';

export const wrapRegex = (value: RegExp): string =>
  `${REGEXP_FLAG_PREFIX}${value.toString()}`;

export const unwrapRegex = (value: string): string | RegExp => {
  if (!value.startsWith(REGEXP_FLAG_PREFIX)) {
    return value;
  }
  const raw = value.slice(REGEXP_FLAG_PREFIX.length);
  // Mirror `RegExp.prototype.toString`, which can emit any of `d g i m s u v y`.
  // The previous `[gimuy]` charset silently failed to decode patterns carrying
  // the `d`, `s`, or `v` flag, leaving the raw sentinel string in place (so the
  // pattern matched nothing in browser mode).
  const match = raw.match(/^\/(.+)\/([dgimsuvy]*)$/);
  if (!match) {
    return value;
  }
  const [, pattern, flags] = match;
  return new RegExp(pattern!, flags);
};

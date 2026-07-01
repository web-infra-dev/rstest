/**
 * Format a single console argument to a string for terminal forwarding.
 * Objects are JSON-stringified; Errors keep their stack. This mirrors the
 * browser console's default stringification closely enough for log forwarding.
 */
export const formatArg = (arg: unknown): string => {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
};

// Format specifiers understood by the browser console. `%c` applies CSS in a
// real console; forwarded to a terminal there is no styling, so it is consumed
// and dropped (matching how Node's `util.format` handles it). `%%` is a literal
// percent sign. Kept aligned with the browser console spec (no Node-only `%j`,
// since these logs originate in the browser).
// cspell:ignore sdifo
const HAS_SPECIFIER = /%[sdifoOc%]/;
const SPECIFIER = /%[sdifoOc%]/g;

/**
 * Join console arguments the way a console does. When the first argument is a
 * string carrying `printf`-style specifiers, substitute the following arguments
 * into it (consuming `%c` styles without emitting them), then append any
 * leftover arguments. Otherwise fall back to a plain space-join.
 *
 * Without this, `console.info('%cText', 'font-weight:bold')` (e.g. React's
 * DevTools notice) leaks the raw `%c` directive and its CSS argument into the
 * forwarded terminal output.
 */
export const formatConsoleArgs = (args: unknown[]): string => {
  const first = args[0];
  if (typeof first !== 'string' || !HAS_SPECIFIER.test(first)) {
    return args.map(formatArg).join(' ');
  }

  let next = 1;
  const substituted = first.replace(SPECIFIER, (spec) => {
    if (spec === '%%') return '%';
    if (next >= args.length) return spec; // no argument left to consume
    const arg = args[next++];
    switch (spec) {
      case '%c':
        return ''; // CSS directive: swallow the style argument
      case '%s':
        return typeof arg === 'string' ? arg : formatArg(arg);
      case '%d':
      case '%i': {
        if (typeof arg === 'bigint') return String(arg);
        const num = Number(arg);
        return Number.isNaN(num) ? 'NaN' : String(Math.trunc(num));
      }
      case '%f': {
        const num = Number(arg);
        return Number.isNaN(num) ? 'NaN' : String(num);
      }
      default: // %o, %O
        return formatArg(arg);
    }
  });

  if (next >= args.length) {
    return substituted;
  }
  return [substituted, ...args.slice(next).map(formatArg)].join(' ');
};

/** Stringify a single console argument for terminal forwarding. */
export const formatArg = (arg: unknown): string => {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  // `JSON.stringify(symbol)` is `undefined`, so a symbol must be handled before
  // the JSON path or it would forward as an empty/`undefined` log.
  if (typeof arg === 'symbol') return arg.toString();
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
// cspell:ignore sdifo WHATWG
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
    if (next >= args.length) return spec;
    const arg = args[next++];
    switch (spec) {
      case '%c':
        return ''; // CSS directive: swallow the style argument
      case '%s':
        return formatArg(arg);
      case '%d':
      case '%i': {
        // Match the browser console formatter (WHATWG): parseInt on the value,
        // so unit-suffixed strings like '42px' format as 42 (not NaN).
        // `String()` first keeps Symbol safe — a bare `parseInt(symbol)` throws
        // via ToString, whereas the spec maps a Symbol to NaN.
        const num = Number.parseInt(String(arg), 10);
        return Number.isNaN(num) ? 'NaN' : String(num);
      }
      case '%f': {
        const num = Number.parseFloat(String(arg));
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

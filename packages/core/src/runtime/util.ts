import type { FormattedError, Test, TestOptions } from '../types';

/**
 * Resolve the overloaded trailing arguments of `test` / `it` / `test.each` /
 * `test.for`, which accept two shapes:
 * - `(name, fn, timeout?)` — `arg2` is the test fn, `arg3` an optional numeric timeout.
 * - `(name, options, fn?)` — `arg2` is a `TestOptions` object, `arg3` the test fn.
 *
 * In the function-first shape `arg3` is only honored as a numeric timeout; an options
 * object is no longer accepted there (it is a type error and ignored at runtime).
 */
export const resolveTestArgs = <Fn extends (...args: any[]) => any>(
  arg2?: Fn | TestOptions,
  arg3?: Fn | number,
): { fn?: Fn; options: TestOptions } => {
  if (typeof arg2 === 'function') {
    return {
      fn: arg2,
      options: typeof arg3 === 'number' ? { timeout: arg3 } : {},
    };
  }
  return { fn: arg3 as Fn | undefined, options: arg2 ?? {} };
};

const loadDiffModules = async () => {
  const [{ diff }, { format, plugins }] = await Promise.all([
    import('@vitest/utils/diff'),
    import('@vitest/pretty-format'),
  ]);

  return {
    diff,
    format,
    formatPlugins: Object.values(plugins),
  };
};

const ISTANBUL_COVERAGE_HELPER_REFERENCE_ERROR_REGEXP =
  /(?:cov_[A-Za-z0-9_$]+.*\bis not defined\b|\bis not defined\b.*cov_[A-Za-z0-9_$]+)/;

const ISTANBUL_COVERAGE_HELPER_HINT = [
  '',
  'This looks like an Istanbul coverage counter from instrumented code executed outside its original scope or realm.',
  'It can happen when a function is serialized with fn.toString() or executed via page.evaluate, Worker, node:vm, eval, or new Function.',
].join('\n');

const ISTANBUL_COVERAGE_HELPER_WORKAROUND_HINT =
  "Exclude that source file with coverage.exclude, add an Istanbul ignore hint for small isolated snippets, switch to coverage.provider: 'v8' for non-browser tests, or avoid serializing Istanbul-instrumented functions.";

const ISTANBUL_COVERAGE_HELPER_BROWSER_WORKAROUND_HINT =
  'Exclude that source file with coverage.exclude, add an Istanbul ignore hint for small isolated snippets, or avoid serializing Istanbul-instrumented functions.';

const isBrowserModeRuntime = (): boolean => {
  const windowObject = (globalThis as { window?: unknown }).window;

  return (
    typeof windowObject === 'object' &&
    windowObject !== null &&
    '__RSTEST_BROWSER_OPTIONS__' in windowObject
  );
};

const appendIstanbulCoverageHelperHint = (message: string): string => {
  if (
    message.includes('Istanbul coverage counter') ||
    !ISTANBUL_COVERAGE_HELPER_REFERENCE_ERROR_REGEXP.test(message)
  ) {
    return message;
  }

  const workaroundHint = isBrowserModeRuntime()
    ? ISTANBUL_COVERAGE_HELPER_BROWSER_WORKAROUND_HINT
    : ISTANBUL_COVERAGE_HELPER_WORKAROUND_HINT;

  return `${message}${ISTANBUL_COVERAGE_HELPER_HINT}\n${workaroundHint}`;
};

const REAL_TIMERS: {
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  setImmediate?: typeof globalThis.setImmediate;
} = {};

// store the original timers
export const setRealTimers = (): void => {
  REAL_TIMERS.setTimeout ??= globalThis.setTimeout.bind(globalThis);
  REAL_TIMERS.clearTimeout ??= globalThis.clearTimeout.bind(globalThis);
  if (typeof globalThis.setImmediate === 'function') {
    REAL_TIMERS.setImmediate ??= globalThis.setImmediate.bind(globalThis);
  }
};

export const getRealTimers = (): typeof REAL_TIMERS => {
  return REAL_TIMERS;
};

/**
 * Stable reference to `Date.now`, captured before `@sinonjs/fake-timers`
 * can hijack the global. Phase boundaries straddling `tests` rely on this.
 */
const realNow = Date.now.bind(Date);

export const getRealNow = (): number => realNow();

export const formatTestError = async (
  err: any,
  test?: Test,
): Promise<FormattedError[]> => {
  const errors = Array.isArray(err) ? err : [err];

  return Promise.all(
    errors.map(async (rawError) => {
      const error =
        typeof rawError === 'string' ? { message: rawError } : rawError;
      const errObj: FormattedError = {
        fullStack: error.fullStack,
        // Some error attributes cannot be enumerated
        message: error.message,
        name: error.name,
        stack: error.stack,
      };

      if (error instanceof TestRegisterError && test?.type === 'case') {
        errObj.message = `Can't nest describe or test inside a test. ${error.message} because it is nested within test '${test.name}'`;
      }

      if (typeof errObj.message === 'string') {
        errObj.message = appendIstanbulCoverageHelperHint(errObj.message);
      }

      if (
        error.showDiff ||
        (error.showDiff === undefined &&
          error.expected !== undefined &&
          error.actual !== undefined)
      ) {
        const expected = error.expected;
        const actual = error.actual;
        const { diff, format, formatPlugins } = await loadDiffModules();

        errObj.diff = diff(expected, actual, {
          expand: false,
        })!;
        errObj.expected =
          typeof expected === 'string'
            ? expected
            : format(expected, { plugins: formatPlugins });
        errObj.actual =
          typeof actual === 'string'
            ? actual
            : format(actual, { plugins: formatPlugins });
      }

      return errObj;
    }),
  );
};
// cspell:ignore sdjifo
const formatRegExp = /%[sdjifoOc%]/;

const formatTemplate = (template: string, values: any[]): string => {
  if (!formatRegExp.test(template)) {
    return template;
  }

  let valueIndex = 0;
  return template.replace(/%[sdjifoOc%]/g, (specifier) => {
    if (specifier === '%%') {
      return '%';
    }

    const value = values[valueIndex++];

    switch (specifier) {
      case '%s':
      case '%O':
      case '%o':
      case '%c':
        return String(value);
      case '%d':
      case '%i':
        return Number.parseInt(String(value), 10).toString();
      case '%f':
        return Number(value).toString();
      case '%j':
        try {
          return JSON.stringify(value);
        } catch {
          return '[Circular]';
        }
      default:
        return String(value ?? '');
    }
  });
};

export const formatName = (
  template: string,
  param: any[] | Record<string, any>,
  index: number,
): string => {
  let templateStr = template;

  if (['%%', '%#', '%$'].some((flag) => templateStr.includes(flag))) {
    // '%%' single percent sign ('%')
    // '%#' match index (0 based) of the test case
    // '%$' match index (1 based) of the test case
    templateStr = templateStr
      .replace(/%%/g, '__rstest_escaped_%__')
      .replace(/%#/g, `${index}`)
      .replace(/%\$/g, `${index + 1}`)
      .replace(/__rstest_escaped_%__/g, '%%');
  }

  if (Array.isArray(param)) {
    // format printf-like string
    // https://nodejs.org/api/util.html#util_util_format_format_args
    if (formatRegExp.test(templateStr)) {
      return formatTemplate(templateStr, param);
    }
    return templateStr;
  }

  if (formatRegExp.test(templateStr)) {
    templateStr = formatTemplate(templateStr, [param]);
  }

  return templateStr.replace(/\$([$\w.]+)/g, (_, key: string) => {
    const value = getValue(param, key);
    return value?.toString();
  });
};

function getValue(source: any, path: string, defaultValue = undefined): any {
  // a[3].b -> a.3.b
  const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let result = source;
  for (const p of paths) {
    result = result[p];
    if (result === undefined) {
      return defaultValue;
    }
  }
  return result;
}

export function isTemplateStringsArray(
  value: unknown,
): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value && Array.isArray(value.raw);
}

export function parseTemplateTable(
  strings: TemplateStringsArray,
  ...expressions: unknown[]
): Record<string, unknown>[] {
  const raw = strings.join('\0');
  const lines = raw.split('\n').filter((line) => line.trim());

  if (lines.length === 0) return [];

  const headers = lines[0]!
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);

  if (headers.length === 0) return [];

  const result: Record<string, unknown>[] = [];

  for (let i = 0; i < expressions.length; i += headers.length) {
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = expressions[i + j];
    }
    result.push(row);
  }

  return result;
}

export class TestRegisterError extends Error {}

export class TestSkipError extends Error {}

class RstestError extends Error {
  public fullStack?: boolean;
}

export function checkPkgInstalled(name: string): void {
  if (typeof process === 'undefined' || !process.versions?.node) {
    return;
  }

  let resolveFn: ((id: string) => string) | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const req = Function('return require')();
    resolveFn = req?.resolve?.bind(req);
  } catch {
    resolveFn = undefined;
  }

  if (!resolveFn) {
    return;
  }

  try {
    resolveFn(name);
  } catch (error: any) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      const missingError = new RstestError(
        `Missing dependency "${name}". Please install it first.`,
      );
      missingError.fullStack = true;
      throw missingError;
    }
    throw error;
  }
}

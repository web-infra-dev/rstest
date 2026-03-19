import type { FormattedError, Test } from '../types';

const loadDiffModules = async (): Promise<{
  diff: typeof import('jest-diff')['diff'];
  prettyFormat: typeof import('pretty-format')['format'];
  prettyFormatPlugins: typeof import('pretty-format')['plugins'];
}> => {
  const [jestDiff, prettyFormat] = await Promise.all([
    import('jest-diff'),
    import('pretty-format'),
  ]);

  return {
    diff: jestDiff.diff,
    prettyFormat: prettyFormat.format,
    prettyFormatPlugins: prettyFormat.plugins,
  };
};

const REAL_TIMERS: {
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
} = {};

// store the original timers
export const setRealTimers = (): void => {
  REAL_TIMERS.setTimeout ??= globalThis.setTimeout.bind(globalThis);
  REAL_TIMERS.clearTimeout ??= globalThis.clearTimeout.bind(globalThis);
};

export const getRealTimers = (): typeof REAL_TIMERS => {
  return REAL_TIMERS;
};

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

      if (
        error.showDiff ||
        (error.showDiff === undefined &&
          error.expected !== undefined &&
          error.actual !== undefined)
      ) {
        const { diff, prettyFormat, prettyFormatPlugins } =
          await loadDiffModules();

        errObj.diff = diff(error.expected, error.actual, {
          expand: false,
        })!;
        errObj.expected =
          typeof error.expected === 'string'
            ? error.expected
            : prettyFormat(error.expected, {
                plugins: Object.values(prettyFormatPlugins),
              });
        errObj.actual =
          typeof error.actual === 'string'
            ? error.actual
            : prettyFormat(error.actual, {
                plugins: Object.values(prettyFormatPlugins),
              });
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

export class RstestError extends Error {
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

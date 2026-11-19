type PrepareStackTrace = NonNullable<typeof Error.prepareStackTrace>;

/**
 * Defers installing source map support until the first stack is formatted, so
 * a run that never formats an error stack does not load it.
 *
 * The returned function is meant to be assigned to `Error.prepareStackTrace`.
 * `install` must install source-map-support and return the
 * `Error.prepareStackTrace` the installation assigned.
 *
 * A user wrapper may already sit on top of the returned function and delegate
 * to it. Installation assigns the global, so the wrapper is captured first and
 * restored afterwards — it keeps routing stacks through the returned function,
 * which from then on delegates straight to the installed implementation.
 *
 * A failed install is rethrown and forgotten, so the next stack retries instead
 * of degrading every later stack to the bare message.
 */
export const createLazyPrepareStackTrace = (
  install: () => typeof Error.prepareStackTrace,
): PrepareStackTrace => {
  let installedPrepareStackTrace: typeof Error.prepareStackTrace;
  let installed = false;
  let installing = false;

  const prepare: PrepareStackTrace = (error, stack) => {
    if (!installed && !installing) {
      installing = true;
      try {
        const outer = Error.prepareStackTrace;
        installedPrepareStackTrace = install();
        installed = true;
        if (outer && outer !== prepare) {
          Error.prepareStackTrace = outer;
        }
      } finally {
        installing = false;
      }
    }
    return installedPrepareStackTrace
      ? installedPrepareStackTrace(error, stack)
      : String(error);
  };

  return prepare;
};

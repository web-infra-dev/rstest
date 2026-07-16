import { format } from '@vitest/utils';

/**
 * The imported `format` mimics `node:util.format`'s inspection (single-line
 * objects, single-quoted strings, `%d` on non-numeric strings -> `NaN`, `%c`
 * consumed and dropped) but prints Errors without their stack. Node's
 * `util.format` emits the full stack, and forwarded browser errors are only
 * debuggable with one, so Errors are pre-mapped to their stack text.
 */
const replaceErrorWithStack = (arg: unknown): unknown =>
  arg instanceof Error ? arg.stack || `${arg.name}: ${arg.message}` : arg;

/**
 * Format console arguments the way the node worker's console does
 * (`node:util.format` semantics), in a browser-safe implementation. Used by
 * the browser client's console relay so both executors forward identical log
 * text. Known divergence from node: collection wrappers print in loupe's form
 * (`Map{ 'k' => 'v' }` instead of node's `Map(1) { 'k' => 'v' }`).
 */
export const formatConsoleArgs = (args: unknown[]): string =>
  format(...args.map(replaceErrorWithStack));

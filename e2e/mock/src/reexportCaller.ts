// Calls a re-exported namespace export from another module (like `@sentry/react`
// re-exporting `@sentry/browser`'s `captureException`). Under the bug's trigger
// conditions this access is inlined straight to the origin module, which is what
// makes a runtime `rs.spyOn` on the namespace object no-op. `rs.mock(..., { spy })`
// still intercepts it because it replaces the module factory at build time.
import * as NS from './reexport/index';

export function doCapture(): string {
  return NS.captureException('boom');
}

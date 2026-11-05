import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (typeof process.send === 'function' || !isMainThread) {
  register('./rejectVmLexer.mjs', import.meta.url);
}

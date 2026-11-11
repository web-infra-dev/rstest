import { installForkTerminationPolicy } from '../../runtime/worker/setup';
import { isError } from '../../utils/isError';
import {
  buildTestEnvironmentModule,
  type PrebundleWorkerMessage,
} from './testEnvironmentModule';

installForkTerminationPolicy();

let message: PrebundleWorkerMessage;
try {
  message = {
    bundlePath: await buildTestEnvironmentModule(JSON.parse(process.argv[2]!)),
  };
} catch (error) {
  message = { error: isError(error) ? error.message : String(error) };
}
process.send!(message, () => process.exit());

import { pathToFileURL } from 'node:url';
import {
  probeBundledDependency,
  validateBuiltinDependency,
} from '../../runtime/worker/env/testEnvironmentProbe';
import { installForkTerminationPolicy } from '../../runtime/worker/setup';
import { isError } from '../../utils/isError';
import {
  type BuildTestEnvironmentModuleOptions,
  buildTestEnvironmentModule,
  type PrebundleWorkerMessage,
} from './testEnvironmentModule';

installForkTerminationPolicy();

let message: PrebundleWorkerMessage;
try {
  const options: BuildTestEnvironmentModuleOptions = JSON.parse(
    process.argv[2]!,
  );
  const bundlePath = await buildTestEnvironmentModule(options);
  if (options.reference.name === 'jsdom') {
    // Probe jsdom once in this short-lived child so its `.probe-ok` marker is
    // on disk before the first wave of pool workers boots concurrently, and
    // the OS reclaims the probe's heap when this process exits.
    const loaded = validateBuiltinDependency(
      options.reference,
      bundlePath,
      await import(pathToFileURL(bundlePath).href),
    );
    probeBundledDependency(loaded, bundlePath);
  }
  message = { bundlePath };
} catch (error) {
  message = { error: isError(error) ? error.message : String(error) };
}
process.send!(message, () => process.exit());

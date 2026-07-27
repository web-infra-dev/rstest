import {
  applyEnvChanges,
  applyTestEnvMarkers,
  type EnvChanges,
  getForceColorEnv,
} from '../utils';

/**
 * Compose the env a child spawned by this run must see — the worker pool, the
 * `globalSetup` fork, and the runtime config projected onto every task. This is
 * the single transport for a run's env: nothing may reach a child by writing
 * the host `process.env`, which two concurrent runs would clobber.
 *
 * Precedence is `getForceColorEnv()` < `base` < the test-mode markers <
 * `changes` (the setup ran last, so it wins).
 *
 * A deletion is asymmetric, and deliberately so: the key is absent from every
 * env composed after the setup ran, but a node worker already spawned keeps the
 * value it inherited — the projected runtime config can only add keys.
 */
export const composeWorkerEnv = (
  changes: EnvChanges,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...getForceColorEnv(), ...base };
  applyTestEnvMarkers(env);
  applyEnvChanges(env, changes);
  return env;
};

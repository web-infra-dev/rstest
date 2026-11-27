import type { RuntimeRstest } from './index';

declare global {
  var RSTEST_API: RuntimeRstest | undefined;
}

export const getRuntimeAPI = <K extends keyof RuntimeRstest>(
  name: K,
): RuntimeRstest[K] => {
  const member = globalThis.RSTEST_API?.[name];
  if (!member) {
    throw new Error(
      `Rstest API '${name}' is not registered yet, please make sure you are running in a rstest environment.`,
    );
  }
  return member;
};

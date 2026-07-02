export const setup = (): void => {
  // Record the worker-wide flag so the test can assert it was already set
  // while global setup code ran.
  process.env.RSTEST_E2E_FEDERATION_IN_SETUP = String(
    (globalThis as any).__rstest_federation__,
  );
};

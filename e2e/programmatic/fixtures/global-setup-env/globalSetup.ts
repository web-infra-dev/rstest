export default (): void => {
  // Runs in the globalSetup fork. Its env diff has to reach this run's test
  // workers without ever passing through the embedding host's `process.env`.
  process.env.RSTEST_API_GS_ENV = 'from-global-setup';
};

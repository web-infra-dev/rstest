export const globalSetupSourceValue = 'loaded';

if (import.meta.rstest) {
  throw new Error('import.meta.rstest must be undefined in global setup');
}

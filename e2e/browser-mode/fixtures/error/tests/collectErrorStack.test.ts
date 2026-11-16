const error = new Error('Failed to read the test data', {
  cause: new TypeError('remote store is offline'),
});
// A stack that is not text must not reach the reporter.
Object.defineProperty(error, 'stack', { value: ['remote frame'] });
throw error;

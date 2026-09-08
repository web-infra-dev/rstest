module.parent.retryAttempts = (module.parent.retryAttempts ?? 0) + 1;
if (module.parent.retryAttempts === 1) {
  throw new Error('first attempt failed');
}
module.exports = 'retried';

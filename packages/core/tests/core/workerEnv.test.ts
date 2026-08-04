import { composeWorkerEnv } from '../../src/core/workerEnv';

describe('composeWorkerEnv', () => {
  it('carries the base over and injects the test-mode markers', () => {
    const env = composeWorkerEnv({}, { HOST_ONLY: 'kept' });
    expect(env.HOST_ONLY).toBe('kept');
    expect(env.NODE_ENV).toBe('test');
    expect(env.RSTEST).toBe('true');
  });

  it('keeps a NODE_ENV the base already defines', () => {
    const env = composeWorkerEnv({}, { NODE_ENV: 'production' });
    expect(env.NODE_ENV).toBe('production');
  });

  it('applies the change-set last, deleting keys it marks as undefined', () => {
    const env = composeWorkerEnv(
      { FROM_SETUP: 'setup', FROM_HOST: 'setup-wins', DROPPED: undefined },
      { FROM_HOST: 'host', DROPPED: 'gone' },
    );
    expect(env.FROM_SETUP).toBe('setup');
    expect(env.FROM_HOST).toBe('setup-wins');
    expect('DROPPED' in env).toBe(false);
  });

  it('does not mutate the base', () => {
    const base = { HOST_ONLY: 'kept' };
    composeWorkerEnv({ FROM_SETUP: 'setup' }, base);
    expect(base).toEqual({ HOST_ONLY: 'kept' });
  });
});

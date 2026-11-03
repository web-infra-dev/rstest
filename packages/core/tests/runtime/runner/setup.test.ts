import { runSetupFiles } from '../../../src/runtime/runner/setup';

it('drains parallel setup even after a synchronous failure', async () => {
  const error = new Error('setup failed');
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let settled = false;
  const load = rs.fn((entry: string) => {
    if (entry === 'first') throw error;
    return pending;
  });
  const result = runSetupFiles(['first', 'second'], load, 'parallel').catch(
    (reason) => {
      settled = true;
      return reason;
    },
  );
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  finish();
  expect(await result).toBe(error);
});

it('keeps list mode fail-fast', async () => {
  const error = new Error('setup failed');
  const load = rs.fn(() => {
    throw error;
  });
  await expect(runSetupFiles(['first', 'second'], load, 'list')).rejects.toBe(
    error,
  );
  expect(load).toHaveBeenCalledTimes(1);
});

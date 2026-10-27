import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { keepEventLoopAlive } from '../../src/utils/keepAlive';

describe('keepEventLoopAlive', () => {
  const spyOnTimers = () => {
    const setIntervalSpy = rs.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = rs.spyOn(globalThis, 'clearInterval');
    onTestFinished(() => {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
    return { setIntervalSpy, clearIntervalSpy };
  };

  it('holds a referenced timer until the task settles', async () => {
    const { setIntervalSpy, clearIntervalSpy } = spyOnTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = keepEventLoopAlive(async () => {
      await gate;
      return 'done';
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    release();
    await expect(running).resolves.toBe('done');
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('releases the timer when the task rejects', async () => {
    const { clearIntervalSpy } = spyOnTimers();

    await expect(
      keepEventLoopAlive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});

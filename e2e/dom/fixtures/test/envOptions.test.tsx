import { setTimeout as nodeSetTimeout } from 'node:timers';
import { expect, it } from '@rstest/core';

it('should print the url', () => {
  expect(window.location.href).toBe('http://localhost:8081/test-options');
});

it('clears DOM timers created before global timer tracking', async () => {
  const timerWindow = window as typeof window & {
    preInstallTimer: string;
    preInstallTimerFired: boolean;
  };
  Reflect.apply(clearTimeout, globalThis, [timerWindow.preInstallTimer]);
  await new Promise((resolve) => nodeSetTimeout(resolve, 1100));

  expect(timerWindow.preInstallTimerFired).toBe(false);
});

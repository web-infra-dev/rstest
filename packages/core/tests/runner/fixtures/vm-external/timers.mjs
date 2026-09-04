import timers, { setTimeout } from 'node:timers';

export const inspectTimers = () => ({
  defaultExport: timers.setTimeout === globalThis.setTimeout,
  namedExport: setTimeout === globalThis.setTimeout,
});

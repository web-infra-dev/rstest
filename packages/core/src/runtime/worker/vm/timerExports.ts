export const VM_TIMER_EXPORTS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
] as const;

export const VM_PROMISE_TIMER_EXPORTS = [
  'setTimeout',
  'setImmediate',
  'scheduler',
] as const;

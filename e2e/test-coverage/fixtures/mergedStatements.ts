export function covered(log: (message: string) => void) {
  log('first');
  log('second');
}

export function uncovered(log: (message: string) => void) {
  log('third');
  log('fourth');
}

export function comma(log: (message: string) => void) {
  return (log('fifth'), log('sixth'));
}

export function inlined(log: (value: string | (() => void)) => void) {
  const callback = () => {
    log('callback');
  };
  log(callback);
  log('afterCallback');
}

export function inlinedValue(log: (value: string) => void) {
  const words = ['returned'];
  return log(words.join(':'));
}

export function inlinedUncovered(log: (value: string) => void) {
  const words = ['uncalled'];
  return log(words.join(':'));
}

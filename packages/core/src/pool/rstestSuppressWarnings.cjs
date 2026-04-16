const originalEmit = process.emit;

process.emit = function (event, error, ...args) {
  if (event === 'warning' && error.name === 'ExperimentalWarning') {
    return false;
  }

  return Reflect.apply(originalEmit, this, [event, error, ...args]);
};

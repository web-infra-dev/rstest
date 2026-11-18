const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const failure = process.env.TRACE_RSS_FAILURE;
if (failure === 'sample' || failure === 'worker-sample') {
  process.memoryUsage = () => {
    throw new Error('injected memory sampler failure');
  };
} else {
  const open = fs.openSync;
  const close = fs.closeSync;
  const write = fs.writeSync;
  const descriptors = new Set();
  fs.openSync = (path, ...args) => {
    const fd = open(path, ...args);
    if (String(path).includes('trace-rss-')) descriptors.add(fd);
    return fd;
  };
  fs.closeSync = (fd) => {
    if (!descriptors.delete(fd)) return close(fd);
    close(fd);
    throw new Error('injected memory trace close failure');
  };
  if (failure === 'write-close') {
    fs.writeSync = (fd, ...args) => {
      if (descriptors.has(fd)) {
        throw new Error('injected memory trace write failure');
      }
      return write(fd, ...args);
    };
  }
  syncBuiltinESMExports();
}

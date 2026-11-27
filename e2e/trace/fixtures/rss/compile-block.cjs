module.exports = function (source) {
  if (process.env.TRACE_RSS_STAGE === 'compile') {
    process.stdout.write('BLOCKED:compile\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  }
  return source;
};

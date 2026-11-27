module.exports = class {
  execute() {
    process.stdout.write('BLOCKED:coverage\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  }
};

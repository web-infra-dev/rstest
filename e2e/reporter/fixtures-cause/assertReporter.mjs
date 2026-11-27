import assert from 'node:assert';

export default class CountReporter {
  onTestFileResult() {
    assert.strictEqual(1n, 2n);
  }
}

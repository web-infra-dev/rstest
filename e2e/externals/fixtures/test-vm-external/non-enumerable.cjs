Object.defineProperty(exports, 'value', {
  enumerable: false,
  value: 42,
});

const values = new WeakMap([[exports, 43]]);
exports.getterReads = 0;
exports.receiverValue = undefined;
exports.hiddenReceiverValue = undefined;
for (const name of ['receiverValue', 'hiddenReceiverValue']) {
  Object.defineProperty(exports, name, {
    enumerable: name === 'receiverValue',
    get() {
      exports.getterReads++;
      return values.get(this);
    },
  });
}
exports.updateValue = () => values.set(exports, 44);

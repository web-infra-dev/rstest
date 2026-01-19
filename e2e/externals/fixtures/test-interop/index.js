Object.defineProperty(exports, '__esModule', { value: true });

const a = require('./a');

exports.a = a.a;

exports.default = () => {
  return `hello ${a.a}`;
};

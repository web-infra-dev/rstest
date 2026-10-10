#!/usr/bin/env node
function classify(value) {
  if (value > 2) {
    return 'big';
  }
  return value > 0 ? 'small' : 'none';
}
module.exports = { classify };

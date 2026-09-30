function double(value) {
  if (value > 2) {
    return value * 2;
  }
  return value > 0 ? value : 0;
}
module.exports = { double };

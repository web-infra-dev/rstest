export default function customLoader() {
  return `module.exports = ${JSON.stringify(this.getOptions().value)};`;
}

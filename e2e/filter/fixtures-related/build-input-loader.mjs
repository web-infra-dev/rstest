// Declares build inputs without importing them. The module output stays the
// same; the dependencies only exist in the module's build info.
export default function buildInputLoader(source) {
  const { input, missing } = this.getOptions();

  this.addDependency(input);
  if (missing) {
    this.addMissingDependency(missing);
  }

  return source;
}

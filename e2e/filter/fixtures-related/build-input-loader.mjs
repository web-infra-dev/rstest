// Declares a build input without importing it. The module output stays the
// same; the dependency only exists in the module's build info.
export default function buildInputLoader(source) {
  this.addDependency(this.getOptions().input);
  return source;
}

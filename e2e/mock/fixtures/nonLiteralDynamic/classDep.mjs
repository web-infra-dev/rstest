// Imported by targetVarClass.mjs (loaded natively via a variable import). Mocked
// with a factory that returns a different class — the synthetic native-mock
// module must keep the export constructible (`new Service()`).
export class Service {
  greet() {
    return 'REAL';
  }
}

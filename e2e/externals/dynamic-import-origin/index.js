// Template-literal dynamic import. Without `injectDynamicImportOrigin`,
// rstest used to resolve the relative specifier against the test entry,
// which sits in a different directory and does not contain `./translations`.
export const fetchStrings = (locale) =>
  import(`./translations/${locale}/strings.json`);

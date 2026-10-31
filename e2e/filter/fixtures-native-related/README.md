# Native related-selection fixture

The price test loads a CommonJS provider and its helper through Node. The stock
test is independent. The explicit `javascript/esm` test module type prevents the
literal `require` from bundling those native files; changing the helper must
still select the price test.

This fixture requires the proposed native Rspack metadata producer. The
`COMPLETE_NATIVE_INPUTS=1` variant demonstrates an experimental completeness
contract, not an existing public Rstest configuration API. Its loader uses the
existing `addDependency` / `addMissingDependency` APIs; the separate
`finishModules` marker promises that the listed files are the importer's complete
native input closure. Omitting a real input breaks that promise and can miss tests.

From this directory, after building the compatible Rstest and Rspack packages:

```sh
pnpm exec rstest run
pnpm exec rstest list --filesOnly --related native/helper.cjs
```

The full run passes two tests, while related selection lists only
`price.test.mjs`. The parent E2E spec copies this fixture before mutating the
helper or replacing the price test with computed and aliased native loading.
It checks exact file sets, actual assertion failures, and explicit rejection
when the automatic analysis cannot establish the dependency closure.

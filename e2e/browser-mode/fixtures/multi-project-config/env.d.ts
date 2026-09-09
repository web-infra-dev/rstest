// `@only-b` is provided at build time via project-b's `resolve.alias`. Declare
// it for the type-checker, which uses e2e/tsconfig.json (not the per-fixture
// tsconfig `paths`).
declare module '@only-b' {
  export const onlyB: string;
}

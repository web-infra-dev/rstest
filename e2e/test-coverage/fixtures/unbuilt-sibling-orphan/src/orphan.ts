// Source under `coverage.include` for the unbuilt sibling project (which matches
// zero test files, so its environment is never built and its istanbul swc
// transform is never registered). It must be scoped out of untested-file
// instrumentation — otherwise generating coverage throws
// `... swc transform function for <env> is not registered`.
export const orphan = (a: number, b: number): number => a - b;

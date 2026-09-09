// Same contract as `shared.ts`, but reached via dynamic `import()` so the
// dynamic-import + asset-resolution path is covered too.
const g = globalThis as Record<string, any>;
g.__rstestDynEvalCount = (g.__rstestDynEvalCount ?? 0) + 1;
const evalIdAtLoad: number = g.__rstestDynEvalCount;

export const getDynEvalId = (): number => evalIdAtLoad;

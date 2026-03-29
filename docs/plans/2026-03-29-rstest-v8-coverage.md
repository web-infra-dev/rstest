# rstest V8 coverage provider implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the V8 coverage provider for rstest to natively support node V8 coverage capabilities, running conversion directly within test worker threads.

**Architecture:** We will modify the core `CoverageProvider` types to support async execution (`init` and `collect`). We will then update the test execution worker to `await` these steps. Next, we will recreate the `@rstest/coverage-v8` package skeleton and construct the `v8` `CoverageProvider` leveraging `node:inspector` for data collection and `ast-v8-to-istanbul` for V8 byte-offset translation into standard Istanbul CoverageMaps directly inside the worker threads.

**Tech Stack:** TypeScript, `node:inspector`, `istanbul-lib-coverage`, `ast-v8-to-istanbul`.

---

### Task 1: update core coverage interfaces to support async provider lifecycle

**Files:**

- Modify: `packages/core/src/types/coverage.ts`
- Modify: `packages/core/src/runtime/worker/index.ts`
- Modify: `packages/core/src/coverage/index.ts`
- Test: `tests/core/coverage.test.ts` (assuming general coverage test exists or we skip unit test here as it's a structural change)

**Step 1: Modify `CoverageProvider` typings in `packages/core/src/types/coverage.ts`**

Update `init()` to `init(): void | Promise<void>;`
Update `collect()` to `collect(): CoverageMap | null | Promise<CoverageMap | null>;`

**Step 2: Update Worker thread implementation to support async calls in `packages/core/src/runtime/worker/index.ts`**

Find `coverageProvider.init()` and change to `await coverageProvider.init();`
Find `const coverageMap = coverageProvider.collect();` and change to `const coverageMap = await coverageProvider.collect();`

**Step 3: Update Provider Resolution in `packages/core/src/coverage/index.ts`**

Add `'v8': '@rstest/coverage-v8'` to the `CoverageProviderMap` object.

**Step 4: Commit**

```bash
git add packages/core/src/types/coverage.ts packages/core/src/runtime/worker/index.ts packages/core/src/coverage/index.ts
git commit -m "feat(core): update CoverageProvider to support async init and collect"
```

---

### Task 2: scaffold the `@rstest/coverage-v8` package and install dependencies

**Files:**

- Create: `packages/coverage-v8/package.json`
- Create: `packages/coverage-v8/rslib.config.ts`
- Create: `packages/coverage-v8/src/index.ts`
- Create: `packages/coverage-v8/src/provider.ts`

**Step 1: Write `packages/coverage-v8/package.json`**

```json
{
  "name": "@rstest/coverage-v8",
  "version": "0.3.0",
  "description": "V8 coverage provider for Rstest",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "rslib build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "istanbul-lib-coverage": "^3.2.2",
    "istanbul-lib-report": "^3.0.1",
    "istanbul-reports": "^3.2.0",
    "ast-v8-to-istanbul": "^1.0.0"
  },
  "devDependencies": {
    "@rslib/core": "0.20.0",
    "@rstest/core": "workspace:*",
    "@rstest/tsconfig": "workspace:*",
    "@types/node": "^22.16.5",
    "typescript": "^5.9.3"
  },
  "peerDependencies": {
    "@rstest/core": "workspace:~"
  }
}
```

**Step 2: Initialize basic provider structure in `packages/coverage-v8/src/index.ts`**

```typescript
export { CoverageProvider } from './provider';
```

**Step 3: Define minimal `CoverageProvider` skeleton in `packages/coverage-v8/src/provider.ts`**

```typescript
import type {
  NormalizedCoverageOptions,
  CoverageProvider as RstestCoverageProvider,
} from '@rstest/core';
import istanbulLibCoverage, { CoverageMap } from 'istanbul-lib-coverage';

export class CoverageProvider implements RstestCoverageProvider {
  constructor(private options: NormalizedCoverageOptions) {}

  async init(): Promise<void> {}
  async collect(): Promise<CoverageMap | null> {
    return null;
  }
  createCoverageMap(): CoverageMap {
    return istanbulLibCoverage.createCoverageMap({});
  }
  async generateCoverageForUntestedFiles(): Promise<any[]> {
    return [];
  }
  async generateReports(coverageMap: CoverageMap): Promise<void> {}
  cleanup(): void {}
}
```

**Step 4: Update workspace and install dependencies**

Run: `pnpm install`
Expected: Packages should be installed and linked correctly.

**Step 5: Commit**

```bash
git add packages/coverage-v8
git commit -m "feat(coverage-v8): scaffold coverage-v8 package"
```

---

### Task 3: implement V8 inspector and collection logic

**Files:**

- Modify: `packages/coverage-v8/src/provider.ts`

**Step 1: Implement `init()`**

```typescript
import inspector from 'node:inspector/promises';
// Inside CoverageProvider:
private session: inspector.Session | null = null;

async init(): Promise<void> {
  this.session = new inspector.Session();
  this.session.connect();
  await this.session.post('Profiler.enable');
  await this.session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}
```

**Step 2: Implement `collect()`**

```typescript
import astV8ToIstanbul from 'ast-v8-to-istanbul';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Inside CoverageProvider:
async collect(): Promise<CoverageMap | null> {
  if (!this.session) return null;

  const coverage = await this.session.post('Profiler.takePreciseCoverage');

  await this.session.post('Profiler.stopPreciseCoverage');
  await this.session.post('Profiler.disable');
  this.session.disconnect();
  this.session = null;

  const coverageMap = this.createCoverageMap();

  for (const entry of coverage.result) {
    // Filter out node_modules, internal node files, and rstest test runner scripts
    if (!entry.url.startsWith('file://')) continue;
    if (entry.url.includes('/node_modules/') || entry.url.includes('@rstest/')) continue;

    try {
      const filePath = fileURLToPath(entry.url);
      const code = await fs.readFile(filePath, 'utf-8');

      // Perform translation from V8 byte offsets to Istanbul
      const converter = astV8ToIstanbul(filePath, undefined, { source: code });
      await converter.applyCoverage(entry.functions);
      const istanbulData = converter.toIstanbul();
      coverageMap.merge(istanbulData);
    } catch (e) {
      console.warn(`Failed to process coverage for ${entry.url}:`, e);
    }
  }

  return coverageMap;
}
```

**Step 3: Run project build**

Run: `pnpm run build`
Expected: Build successfully without typing errors.

**Step 4: Commit**

```bash
git add packages/coverage-v8/src/provider.ts
git commit -m "feat(coverage-v8): implement inspector profiling and ast conversion logic"
```

---

### Task 4: implement untested files & report generation

**Files:**

- Modify: `packages/coverage-v8/src/provider.ts`

**Step 1: Implement `generateCoverageForUntestedFiles()`**

```typescript
async generateCoverageForUntestedFiles({ files }: { files: string[] }): Promise<any[]> {
  const results = [];
  for (const file of files) {
    try {
      const code = await fs.readFile(file, 'utf-8');
      // Empty functions array means 0 execution
      const converter = astV8ToIstanbul(file, undefined, { source: code });
      await converter.applyCoverage([]);
      const istanbulData = converter.toIstanbul();
      results.push(istanbulData[Object.keys(istanbulData)[0]]);
    } catch (e) {
      console.error(`Can not generate coverage for untested file: ${file}`, e);
    }
  }
  return results;
}
```

**Step 2: Implement `generateReports()`**

```typescript
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';

// Inside CoverageProvider:
async generateReports(coverageMap: CoverageMap): Promise<void> {
  const context = createContext({
    dir: this.options.reportsDirectory,
    coverageMap: coverageMap,
  });

  const reportersList = this.options.reporters || ['text', 'html', 'json'];
  for (const reporter of reportersList) {
    if (typeof reporter === 'object' && 'execute' in reporter) {
      reporter.execute(context);
    } else {
      const [reporterName, reporterOptions] = Array.isArray(reporter) ? reporter : [reporter, {}];
      const report = reports.create(reporterName as any, reporterOptions);
      report.execute(context);
    }
  }
}
```

**Step 3: Run end-to-end tests**

Run: `pnpm run test`
Expected: E2E and unit tests pass.

**Step 4: Commit**

```bash
git add packages/coverage-v8/src/provider.ts
git commit -m "feat(coverage-v8): implement report generation and untested files"
```

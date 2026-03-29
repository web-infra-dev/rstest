# rstest V8 Coverage Provider Design

## Overview

This document outlines the design for implementing the `@rstest/coverage-v8` package, bringing native V8 coverage capabilities to the `rstest` framework. The implementation is heavily inspired by Vitest but adapted to fit `rstest`'s architecture, specifically by performing the V8-to-Istanbul coverage map conversion within the worker threads.

## Architecture

### 1. Core Package Changes (`@rstest/core`)

To support the asynchronous nature of the `node:inspector` API required for V8 coverage, the core `CoverageProvider` interface will be updated.

- **Async Interfaces**:
  - `init(): void | Promise<void>`
  - `collect(): CoverageMap | null | Promise<CoverageMap | null>`
- **Worker Execution**: The test runner worker (`runtime/worker/index.ts`) will be updated to `await coverageProvider.init()` and `await coverageProvider.collect()`.
- **Provider Resolution**: The `v8` provider will be mapped to `@rstest/coverage-v8` in `coverage/index.ts`.

### 2. Scaffold `@rstest/coverage-v8`

A new package will be scaffolded mirroring the existing `coverage-istanbul` structure.

- **Files**: `package.json`, `rslib.config.ts`, `src/index.ts`, `src/provider.ts`
- **Dependencies**:
  - `istanbul-lib-coverage`
  - `ast-v8-to-istanbul`
  - `istanbul-reports`
  - `istanbul-lib-report`

### 3. V8 Provider Implementation

The core logic resides in the `CoverageProvider` implementation for V8.

- **`init()`**:
  - Connect to a `node:inspector` session.
  - Call `Profiler.enable()` and `Profiler.startPreciseCoverage({ callCount: true, detailed: true })`.
- **`collect()`**:
  - Call `Profiler.takePreciseCoverage()` to retrieve the raw V8 coverage data.
  - Disable the profiler and disconnect the session.
  - **Filtering**: Filter out Node internal files, `node_modules`, and irrelevant test runner modules from the results.
  - **Conversion (Worker-side)**: Iterate over the filtered V8 coverage results. For each file, fetch its source content (and sourcemap) and use `ast-v8-to-istanbul` to convert V8 byte offsets into an Istanbul `CoverageMap`.
  - Return the computed `CoverageMap` to the main thread.
- **`generateCoverageForUntestedFiles()`**: Read included but untested source files, parse them, and use `ast-v8-to-istanbul` with an empty functions array `[]` to generate 0-coverage Istanbul data.
- **`generateReports()`**: Re-use the standard `istanbul-reports` to output HTML/text/lcov formats (identical logic to `coverage-istanbul`).

## Rationale

Converting the V8 byte offsets to Istanbul coverage maps inside the worker threads rather than the main thread diverges slightly from Vitest's approach. This was chosen because:

1.  It avoids changing `rstest`'s IPC data structures (which currently expect Istanbul `CoverageMapData`).
2.  It allows the AST parsing and conversion overhead to be parallelized across the worker threads, offsetting the fact that common files' ASTs might be parsed multiple times.
3.  It significantly simplifies the main thread's `mergeReports` logic, which can continue treating all coverage data uniformly as Istanbul coverage maps.

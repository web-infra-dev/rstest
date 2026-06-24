// A mock defined at the TOP LEVEL of a module SHARED across files. Under
// `isolate: false` this module is evaluated once per worker, so the mock
// instance persists across files. `clearMocks: true` must therefore keep
// resetting it before every test, in every file — even though the per-worker
// mock registry is reset per file. A registry that drops the kept mock without
// re-registering it (the shared module never re-runs) leaks this mock's call
// history into later files.
// See https://github.com/web-infra-dev/rstest/pull/1376#discussion_r3457255132.
import { rstest } from '@rstest/core';

export const sharedMock = rstest.fn((x: number) => x);

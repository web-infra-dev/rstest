import { threadId } from 'node:worker_threads';
import { expect } from '@rstest/core';

export function assertFreshEnvironment(): void {
  expect(Reflect.get(globalThis, 'environmentCommentMarker')).toBeUndefined();
  Reflect.set(globalThis, 'environmentCommentMarker', true);

  const body = globalThis.document?.body;
  if (body) {
    expect(body.dataset.environmentCommentMarker).toBeUndefined();
    body.dataset.environmentCommentMarker = 'set';
  }

  console.log(`environment-comment-worker: ${process.pid}:${threadId}`);
}

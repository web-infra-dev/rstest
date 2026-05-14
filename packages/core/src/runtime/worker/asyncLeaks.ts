import { createHook } from 'node:async_hooks';
import type { CurrentTaskInfo, FormattedError } from '../../types';
import { getTaskNameWithPrefix } from '../../utils/helper';
import type { TaskContext } from './taskContext';

type AsyncLeak = {
  type: string;
  stack?: string;
  task?: CurrentTaskInfo;
  resource?: unknown;
};

type AsyncLeakDetector = {
  enable: () => void;
  collectErrors: () => Promise<FormattedError[]>;
  disable: () => void;
};

const MAX_LEAKS_TO_REPORT = 20;

const IGNORED_ASYNC_RESOURCE_TYPES = new Set([
  'PROMISE',
  'TickObject',
  'Microtask',
  'CustomGC',
  'DNSCHANNEL',
  'ELDHISTOGRAM',
  'PerformanceObserver',
  'PIPEWRAP',
  'PROCESSWRAP',
  'RANDOMBYTESREQUEST',
  'SIGNREQUEST',
  'WORKER',
  // Node.js keeps the native zlib async resource alive until the stream
  // wrapper is garbage collected, even after the stream emits `close`.
  'ZLIB',
  // Created by stream.finished()/finished-promises internals and may outlive
  // the observed stream after it has already settled.
  'STREAM_END_OF_STREAM',
  // N-API ThreadsafeFunction/native cleanup resources are often unref'ed
  // and owned by native wrappers; reporting them after the JS operation
  // completes creates false positives for native toolchains such as Rspack.
  'napi_js_callback',
  'napi_rs_threadsafe_function',
  'delete_reference',
  'delete_reference_ts_fn',
]);

const formatLeakTaskName = (task?: CurrentTaskInfo): string => {
  if (!task) return 'unknown task';
  if (task.taskType === 'file') return 'file setup';
  return getTaskNameWithPrefix({
    name: task.taskName ?? '',
    parentNames: task.taskParentNames,
  });
};

const isIgnorableActiveResource = (leak: AsyncLeak): boolean => {
  const resource = leak.resource;

  return (
    typeof resource === 'object' &&
    resource !== null &&
    'hasRef' in resource &&
    typeof resource.hasRef === 'function' &&
    resource.hasRef() === false
  );
};

const getCreationStack = (): string | undefined => {
  const stack = new Error('Async resource was created here').stack;
  if (!stack) return undefined;

  return stack
    .split('\n')
    .filter((line) => !line.includes('runtime/worker/asyncLeaks'))
    .join('\n');
};

const createLeakError = (leak: AsyncLeak): FormattedError => {
  const taskName = formatLeakTaskName(leak.task);

  return {
    name: 'AsyncLeakError',
    message: `Detected async leak: ${leak.type} was still active after ${taskName} finished.`,
    stack: leak.stack,
  };
};

export const createAsyncLeakDetector = (
  taskContext: TaskContext,
): AsyncLeakDetector => {
  const activeResources = new Map<number, AsyncLeak>();

  const hook = createHook({
    init(asyncId, type, _triggerAsyncId, resource) {
      if (IGNORED_ASYNC_RESOURCE_TYPES.has(type)) return;

      const task = taskContext.getCurrent();
      if (!task) return;

      activeResources.set(asyncId, {
        type,
        task: { ...task },
        stack: getCreationStack(),
        resource,
      });
    },
    destroy(asyncId) {
      activeResources.delete(asyncId);
    },
    promiseResolve(asyncId) {
      activeResources.delete(asyncId);
    },
  });

  return {
    enable: () => {
      activeResources.clear();
      hook.enable();
    },
    async collectErrors(): Promise<FormattedError[]> {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 0));
      hook.disable();

      return Array.from(activeResources.values())
        .filter((leak) => !isIgnorableActiveResource(leak))
        .slice(0, MAX_LEAKS_TO_REPORT)
        .map(createLeakError);
    },
    disable: () => {
      hook.disable();
      activeResources.clear();
    },
  };
};

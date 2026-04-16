const WORKER_META_MESSAGE_TYPE = 'rstest:worker-meta';
const WORKER_META_MESSAGE_VERSION = 1;
const WORKER_META_MESSAGE_NAMESPACE = 'rstest';

export interface WorkerMetaMessage {
  pid: number;
}

interface WorkerMetaEnvelope {
  __rstest_internal__: typeof WORKER_META_MESSAGE_NAMESPACE;
  payload: WorkerMetaMessage;
  type: typeof WORKER_META_MESSAGE_TYPE;
  version: typeof WORKER_META_MESSAGE_VERSION;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

export const createWorkerMetaMessage = (pid: number): WorkerMetaEnvelope => {
  return {
    __rstest_internal__: WORKER_META_MESSAGE_NAMESPACE,
    payload: {
      pid,
    },
    type: WORKER_META_MESSAGE_TYPE,
    version: WORKER_META_MESSAGE_VERSION,
  };
};

export const parseWorkerMetaMessage = (
  message: unknown,
): WorkerMetaMessage | undefined => {
  if (!isRecord(message)) {
    return undefined;
  }

  if (
    message.__rstest_internal__ === WORKER_META_MESSAGE_NAMESPACE &&
    message.type === WORKER_META_MESSAGE_TYPE &&
    message.version === WORKER_META_MESSAGE_VERSION &&
    isRecord(message.payload) &&
    typeof message.payload.pid === 'number'
  ) {
    return {
      pid: message.payload.pid,
    };
  }

  return undefined;
};

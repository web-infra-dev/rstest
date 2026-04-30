import type {
  FormattedError,
  RunWorkerOptions,
  Test,
  TestFileResult,
} from '../types';

const WORKER_REQUEST_TAG = '__rstest_worker_request__' as const;
const WORKER_RESPONSE_TAG = '__rstest_worker_response__' as const;
const RPC_TAG = '__rstest_rpc__' as const;

export type WorkerRequest =
  | { type: 'start'; workerId: number }
  | {
      type: 'run';
      taskId: number;
      options: RunWorkerOptions['options'];
    }
  | {
      type: 'collect';
      taskId: number;
      options: RunWorkerOptions['options'];
    }
  | { type: 'stop' };

export type CollectTaskResult = {
  tests: Test[];
  testPath: string;
  project: string;
  errors?: FormattedError[];
};

export type WorkerResponse =
  | { type: 'started'; pid: number }
  | {
      type: 'runFinished';
      taskId: number;
      result: TestFileResult;
    }
  | {
      type: 'collectFinished';
      taskId: number;
      result: CollectTaskResult;
    }
  | { type: 'stopped' }
  | {
      type: 'fatal_error';
      error: SerializedError;
    };

export type SerializedError = {
  name?: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

export type RpcEnvelope = {
  [RPC_TAG]: true;
  payload: unknown;
};

export type WorkerRequestEnvelope = {
  [WORKER_REQUEST_TAG]: true;
  request: WorkerRequest;
};

export type WorkerResponseEnvelope = {
  [WORKER_RESPONSE_TAG]: true;
  response: WorkerResponse;
};

export type Envelope =
  | WorkerRequestEnvelope
  | WorkerResponseEnvelope
  | RpcEnvelope;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

export const wrapWorkerRequest = (
  request: WorkerRequest,
): WorkerRequestEnvelope => {
  return { [WORKER_REQUEST_TAG]: true, request };
};

export const wrapWorkerResponse = (
  response: WorkerResponse,
): WorkerResponseEnvelope => {
  return { [WORKER_RESPONSE_TAG]: true, response };
};

export const wrapRpc = (payload: unknown): RpcEnvelope => {
  return { [RPC_TAG]: true, payload };
};

export const isWorkerRequestEnvelope = (
  message: unknown,
): message is WorkerRequestEnvelope => {
  return isRecord(message) && message[WORKER_REQUEST_TAG] === true;
};

export const isWorkerResponseEnvelope = (
  message: unknown,
): message is WorkerResponseEnvelope => {
  return isRecord(message) && message[WORKER_RESPONSE_TAG] === true;
};

export const isRpcEnvelope = (message: unknown): message is RpcEnvelope => {
  return isRecord(message) && message[RPC_TAG] === true;
};

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: (error as Error & { cause?: unknown }).cause,
    };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: String(error) };
};

export const deserializeError = (data: SerializedError): Error => {
  const error = new Error(data.message);
  if (data.name) {
    try {
      error.name = data.name;
    } catch {
      // ignore: some Error subclasses freeze name
    }
  }
  if (data.stack) {
    error.stack = data.stack;
  }
  if (data.cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = data.cause;
  }
  return error;
};

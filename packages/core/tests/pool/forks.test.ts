import {
  createForksChannel,
  isIgnorableTinypoolProcessSendError,
  patchTinypoolProcessWorkerSend,
} from '../../src/pool/forks';

describe('createForksChannel', () => {
  it('should disable birpc timeout', () => {
    let options: Record<string, unknown> | undefined;

    createForksChannel({} as any, undefined, (_functions, birpcOptions) => {
      options = birpcOptions as unknown as Record<string, unknown>;
      return {
        $close() {},
      } as any;
    });

    expect(options).toBeDefined();
    expect(options?.timeout).toBe(-1);
  });

  it('should close rpc with an explicit error when cleaning channel', () => {
    let closeError: Error | undefined;

    const { cleanup } = createForksChannel(
      {} as any,
      undefined,
      () =>
        ({
          $close(error?: Error) {
            closeError = error;
          },
        }) as any,
    );

    cleanup();

    expect(closeError).toBeInstanceOf(Error);
    expect(closeError?.message).toBe(
      '[rstest-pool]: Pending methods while closing rpc',
    );
  });
});

describe('isIgnorableTinypoolProcessSendError', () => {
  it('should ignore Windows write UNKNOWN errors', () => {
    const error = Object.assign(new Error('write UNKNOWN'), {
      code: 'UNKNOWN',
    });

    expect(isIgnorableTinypoolProcessSendError(error, 'win32')).toBe(true);
  });

  it('should ignore closed IPC channel errors', () => {
    const error = Object.assign(new Error('Channel closed'), {
      code: 'ERR_IPC_CHANNEL_CLOSED',
    });

    expect(isIgnorableTinypoolProcessSendError(error, 'darwin')).toBe(true);
  });

  it('should ignore Windows UNKNOWN code errors even without Error instances', () => {
    const error = {
      code: 'UNKNOWN',
      message: 'write UNKNOWN',
    };

    expect(isIgnorableTinypoolProcessSendError(error, 'win32')).toBe(true);
  });

  it('should not ignore unrelated errors', () => {
    expect(
      isIgnorableTinypoolProcessSendError(new Error('boom'), 'win32'),
    ).toBe(false);
  });
});

describe('patchTinypoolProcessWorkerSend', () => {
  it('should swallow ignorable send errors from child-process workers', () => {
    const worker = Object.create({
      send() {
        throw Object.assign(new Error('write UNKNOWN'), {
          code: 'UNKNOWN',
        });
      },
    }) as {
      runtime: string;
      send: (message: { taskId: number }) => void;
    };
    worker.runtime = 'child_process';

    patchTinypoolProcessWorkerSend(
      {
        threads: [worker as any],
      },
      'win32',
    );

    expect(() => worker.send({ taskId: 1 })).not.toThrow();
  });

  it('should preserve non-ignorable send errors', () => {
    const worker = Object.create({
      send() {
        throw new Error('boom');
      },
    }) as {
      runtime: string;
      send: (message: { taskId: number }) => void;
    };
    worker.runtime = 'child_process';

    patchTinypoolProcessWorkerSend({
      threads: [worker as any],
    });

    expect(() => worker.send({ taskId: 1 })).toThrow('boom');
  });

  it('should skip sends for disconnected child-process workers', () => {
    let called = 0;
    const worker = Object.create({
      send() {
        called += 1;
      },
    }) as {
      process: { connected: boolean; exitCode: null; killed: boolean };
      runtime: string;
      send: (message: { taskId: number }) => void;
    };
    worker.runtime = 'child_process';
    worker.process = {
      connected: false,
      exitCode: null,
      killed: false,
    };

    patchTinypoolProcessWorkerSend({
      threads: [worker as any],
    });

    worker.send({ taskId: 1 });

    expect(called).toBe(0);
  });
});

import { createForksChannel } from '../../src/pool/forks';

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

import { createRuntimeRpc } from '../../../src/runtime/worker/rpc';

describe('createRuntimeRpc', () => {
  it('should disable birpc timeout', () => {
    let options: Record<string, unknown> | undefined;

    createRuntimeRpc(
      {
        serialize: (v) => v as Uint8Array,
        deserialize: (v) => v as unknown,
        post() {},
        on() {},
      },
      (_functions, birpcOptions) => {
        options = birpcOptions as unknown as Record<string, unknown>;
        return {} as any;
      },
    );

    expect(options).toBeDefined();
    expect(options?.timeout).toBe(-1);
  });
});

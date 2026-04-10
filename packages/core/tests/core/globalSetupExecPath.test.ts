var tinypoolRunMock: ReturnType<typeof rs.fn>;
var tinypoolDestroyMock: ReturnType<typeof rs.fn>;
var tinypoolConstructorMock: ReturnType<typeof rs.fn>;

function getTinypoolRunMock() {
  if (!tinypoolRunMock) {
    tinypoolRunMock = rs.fn(async () => ({ success: false }));
  }

  return tinypoolRunMock;
}

function getTinypoolDestroyMock() {
  if (!tinypoolDestroyMock) {
    tinypoolDestroyMock = rs.fn(async () => undefined);
  }

  return tinypoolDestroyMock;
}

function getTinypoolConstructorMock() {
  if (!tinypoolConstructorMock) {
    tinypoolConstructorMock = rs.fn(() => {
      return {
        run: getTinypoolRunMock(),
        destroy: getTinypoolDestroyMock(),
        threads: [],
      };
    });
  }

  return tinypoolConstructorMock;
}

rs.mock('tinypool', () => ({
  Tinypool: getTinypoolConstructorMock(),
}));

import { runGlobalSetup } from '../../src/core/globalSetup';

describe('runGlobalSetup', () => {
  beforeEach(() => {
    tinypoolConstructorMock?.mockClear();
    tinypoolRunMock?.mockClear();
    tinypoolDestroyMock?.mockClear();
  });

  it('should pin global setup worker execPath to the current Node runtime', async () => {
    await runGlobalSetup({
      globalSetupEntries: [],
      assetFiles: {},
      sourceMaps: {},
      interopDefault: false,
      outputModule: false,
    });

    expect(tinypoolConstructorMock).toHaveBeenCalledTimes(1);
    expect(tinypoolConstructorMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        runtime: 'child_process',
        execPath: process.execPath,
      }),
    );
  });
});

var tinypoolConstructorMock: ReturnType<typeof rs.fn>;

function getTinypoolConstructorMock() {
  if (!tinypoolConstructorMock) {
    tinypoolConstructorMock = rs.fn(() => ({
      run: rs.fn(),
      destroy: rs.fn(),
      threads: [],
    }));
  }

  return tinypoolConstructorMock;
}

rs.mock('tinypool', () => ({
  Tinypool: getTinypoolConstructorMock(),
}));

import { createForksPool } from '../../src/pool/forks';

describe('createForksPool', () => {
  beforeEach(() => {
    tinypoolConstructorMock.mockClear();
  });

  it('should pin worker execPath to the current Node runtime', () => {
    const pool = createForksPool({
      env: {},
      execArgv: [],
      isolate: true,
      maxWorkers: 1,
      minWorkers: 1,
    });

    expect(tinypoolConstructorMock).toHaveBeenCalledTimes(1);
    expect(tinypoolConstructorMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        runtime: 'child_process',
        execPath: process.execPath,
      }),
    );

    return pool.close();
  });
});

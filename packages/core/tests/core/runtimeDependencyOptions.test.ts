import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import { resolveRuntimeDependencyConsumers } from '../../src/core/execution/runtimeDependencies';

const spawn = rs.hoisted(() => rs.fn());
rs.mock('node:child_process', () => ({ spawn }));

beforeEach(() => {
  spawn.mockReset();
});

const select = (execArgv: string[], nodeOptions = '') =>
  resolveRuntimeDependencyConsumers({
    requests: [
      {
        consumer: '/project/example.test.ts',
        source: '/project/example.test.ts',
        call: { kind: 'resolve', origin: 'source', parts: ['./price.cjs'] },
      },
    ],
    sources: new Set(['/project/price.cjs']),
    pool: { type: 'threads', execArgv },
    env: { NODE_OPTIONS: nodeOptions },
  });

describe('native dependency analysis loading options', () => {
  it.each([
    ['--loader', './loader.mjs'],
    ['--experimental-loader=./loader.mjs'],
    ['--experimental_loader', './loader.mjs'],
    ['--import=./register.mjs'],
    ['--require', './register.cjs'],
    ['-r./register.cjs'],
    ['--env-file=./runtime.env'],
    ['--env_file_if_exists', './runtime.env'],
    ['--experimental-config-file=./node.config.json'],
    ['--experimental_default_config_file'],
  ])('rejects loading hooks before spawning: %j', async (...options) => {
    await expect(select(options)).rejects.toThrow('custom Node loading hooks');
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    '--experimental_loader=./loader.mjs',
    '"--experimental_loader" "./loader with spaces.mjs"',
    '--experimental_"loader"=./loader.mjs',
    '"--experimental_\\loader=./loader.mjs"',
    '--conditions=custom "--import=./register.mjs"',
    '"-r./register with spaces.cjs"',
  ])(
    'parses quoted NODE_OPTIONS before checking hooks: %s',
    async (options) => {
      await expect(select([], options)).rejects.toThrow(
        'custom Node loading hooks',
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['"--conditions=custom', '"--conditions=custom\\'])(
    'rejects malformed NODE_OPTIONS before spawning: %s',
    async (options) => {
      await expect(select([], options)).rejects.toThrow('Invalid NODE_OPTIONS');
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it('does not mistake option values containing hook names for a hook', async () => {
    spawn.mockImplementation(() => {
      throw new Error('worker launched');
    });
    await expect(
      select(['--conditions=custom--loader'], '--conditions="custom --import"'),
    ).rejects.toThrow('worker launched');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('needs no analysis process when complete declarations cover all requests', async () => {
    expect(
      await resolveRuntimeDependencyConsumers({
        requests: [],
        sources: new Set(['/project/price.cjs']),
        pool: { execArgv: ['--experimental_loader=./loader.mjs'] },
        env: {},
      }),
    ).toEqual(new Set());
    expect(spawn).not.toHaveBeenCalled();
  });
});

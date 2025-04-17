import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

describe('Expect API', () => {
  it('test expect API', () => {
    expect(1 + 1).toBe(2);
    expect('blue red').toBeDefined();
    expect(Number.NaN).toBeNaN();

    const hi = () => {};
    expect(hi()).toBeUndefined();
    expect(hi()).toBeFalsy();

    const sayHi = () => 'hi';
    expect(sayHi()).toBe('hi');
    expect(sayHi()).toBeTruthy();

    expect(['blue', 'red']).toContain('blue');
  });

  it('test expect matcher', () => {
    expect('blue red').toMatch('red');
    expect('blue red').toMatch(/red/);
    expect({ type: 'color', name: 'red' }).toMatchObject({ type: 'color' });
  });

  it('test expect modifiers', () => {
    expect(Promise.resolve('blue')).resolves.toBe('blue');
    expect(Promise.reject(new Error('red'))).rejects.toThrow('red');
  });

  it('test expect assertions', () => {
    expect.assertions(3);
    expect(1 + 1).toBe(2);
    expect(1 + 2).toBe(3);
    expect(1 + 3).toBe(4);
  });

  it('test expect API not', () => {
    expect(1 + 1).not.toBe(3);
    expect('blue red').not.toBeUndefined();
    expect(1).not.toBeNaN();

    expect(true).not.toBeFalsy();
    expect(false).not.toBeTruthy();

    expect(['blue', 'red']).not.toContain('blu');
    expect('blue red').not.toMatch('redd');
  });

  it.fails('test not failed', () => {
    expect(1 + 1).not.toBe(2);
  });

  it.fails('test expect assertions failed', () => {
    expect(1 + 1).toBe(2);
    expect.assertions(2);
    expect(1 + 2).toBe(3);
    expect(1 + 3).toBe(4);
  });

  it('test function undefined', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/undefined.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(
      logs.find((log) =>
        log.includes('Tests 1 failed | 1 passed | 1 skipped | 1 todo'),
      ),
    ).toBeTruthy();
  });
});

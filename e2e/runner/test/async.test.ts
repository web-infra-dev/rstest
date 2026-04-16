import { afterAll, afterEach, describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts/utils';

const logs: string[] = [];
const runIds: [string, string][] = [];

afterEach(({ task }) => {
  runIds.push([task.id, task.name]);
});

afterAll(() => {
  expect(logs).toEqual([
    'run 0-0',
    'run 0-1-0',
    'run 0-1-1-0',
    'run 0-2-0',
    'run 0-3',
    'run 1-0',
    'run 2-0-0',
    'run 2-1',
    'run 3-0',
  ]);
  expect(runIds).toMatchInlineSnapshot(`
    [
      [
        "419cefd87e_0_0_0",
        "0-0",
      ],
      [
        "419cefd87e_0_0_1_0",
        "0-1-0",
      ],
      [
        "419cefd87e_0_0_1_1_0",
        "0-1-1-0",
      ],
      [
        "419cefd87e_0_0_2_0",
        "0-2-0",
      ],
      [
        "419cefd87e_0_0_3",
        "0-3",
      ],
      [
        "419cefd87e_0_1",
        "1",
      ],
      [
        "419cefd87e_0_2_0_0",
        "2-0-0",
      ],
      [
        "419cefd87e_0_2_1",
        "2-1",
      ],
      [
        "419cefd87e_0_3",
        "3",
      ],
    ]
  `);
});

describe('should run async suite in the correct order', () => {
  describe('0', async () => {
    await sleep(100);

    it('0-0', () => {
      logs.push('run 0-0');
      expect(1 + 1).toBe(2);
    });

    describe('0-1', async () => {
      it('0-1-0', () => {
        logs.push('run 0-1-0');
        expect(1 + 1).toBe(2);
      });

      describe('0-1-1', () => {
        it('0-1-1-0', () => {
          logs.push('run 0-1-1-0');
          expect(1 + 1).toBe(2);
        });
      });
    });

    describe('0-2', () => {
      it('0-2-0', () => {
        logs.push('run 0-2-0');
        expect(1 + 1).toBe(2);
      });
    });

    it('0-3', () => {
      logs.push('run 0-3');
      expect(1 + 1).toBe(2);
    });
  });

  it('1', () => {
    logs.push('run 1-0');
    expect(1 + 1).toBe(2);
  });

  describe('2', () => {
    describe('2-0', async () => {
      it('2-0-0', () => {
        logs.push('run 2-0-0');
        expect(1 + 1).toBe(2);
      });
    });

    it('2-1', () => {
      logs.push('run 2-1');
      expect(1 + 1).toBe(2);
    });
  });

  it('3', () => {
    logs.push('run 3-0');
    expect(1 + 1).toBe(2);
  });
});

import { afterAll, describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts/utils';

const logs: string[] = [];

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

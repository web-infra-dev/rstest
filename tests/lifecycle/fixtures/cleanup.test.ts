import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@rstest/core';
import { sleep } from '../../scripts';

beforeAll(() => {
  return async () => {
    await sleep(100);
    console.log('[beforeAll] cleanup root');
  };
});

afterAll(() => {
  console.log('[afterAll] root');
});

beforeAll(() => {
  return () => {
    console.log('[beforeAll] cleanup root1');
  };
});

beforeEach(() => {
  return () => {
    console.log('[beforeEach] cleanup root');
  };
});

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);
  });

  beforeAll(() => {
    return () => {
      console.log('[beforeAll] cleanup in level A');
    };
  });

  beforeEach(() => {
    return () => {
      console.log('[beforeEach] cleanup in level A');
    };
  });

  describe('level B-A', () => {
    it('it in level B-A', () => {
      expect(2 + 1).toBe(3);
    });

    beforeAll(() => {
      return () => {
        console.log('[beforeAll] cleanup in level B-A');
      };
    });
  });

  describe('level B-B', () => {
    it('it in level B-B', () => {
      expect(2 + 2).toBe(4);
    });

    beforeAll(() => {
      return () => {
        console.log('[beforeAll] cleanup in level B-B');
      };
    });
  });
});

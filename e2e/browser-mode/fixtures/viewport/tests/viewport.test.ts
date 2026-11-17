import { page } from '@rstest/browser';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  rs,
  test,
} from '@rstest/core';

beforeAll(async () => {
  await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
});

afterAll(async () => {
  await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
});

beforeEach(() => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});

afterEach(() => {
  rs.useRealTimers();
});

test('should apply configured viewport to runner iframe', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});

test('applies real CSS media queries before resolving', async () => {
  const style = document.createElement('style');
  style.textContent =
    'body { --viewport-layout: narrow; } @media (min-width: 768px) { body { --viewport-layout: wide; } }';
  document.head.append(style);
  onTestFinished(() => style.remove());
  await page.viewport(800, 600);
  expect(window.innerWidth).toBe(800);
  expect(window.innerHeight).toBe(600);
  expect(window.matchMedia('(min-width: 768px)').matches).toBe(true);
  expect(
    getComputedStyle(document.body)
      .getPropertyValue('--viewport-layout')
      .trim(),
  ).toBe('wide');
  await page.viewport(320, 480);
  expect(window.matchMedia('(min-width: 768px)').matches).toBe(false);
  expect(
    getComputedStyle(document.body)
      .getPropertyValue('--viewport-layout')
      .trim(),
  ).toBe('narrow');
});

test('restores the default before the next test', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.visualViewport?.scale).toBe(1);
});

test('can return to the default explicitly', async () => {
  await page.viewport(640, 480);
  await page.viewport(390, 844);
  expect(window.innerWidth).toBe(390);
});

describe('cleanup ordering', () => {
  beforeEach(async () => {
    await page.viewport(700, 500);
  });
  afterEach(() => {
    expect(window.innerWidth).toBe(700);
  });
  test('keeps the viewport through test cleanup', ({ onTestFinished }) => {
    expect(window.innerWidth).toBe(700);
    onTestFinished(() => expect(window.innerWidth).toBe(700));
  });
});

let retryAttempt = 0;
test('restores the viewport between retries', { retry: 1 }, async () => {
  await page.viewport(620, 400);
  if (retryAttempt++ === 0) throw new Error('retry the viewport test');
});

test('restores the viewport between repeats', { repeats: 2 }, async () => {
  await page.viewport(630, 410);
});

test('resizes with fake timers enabled', async () => {
  rs.useFakeTimers();
  await page.viewport(640, 480);
  expect(window.innerWidth).toBe(640);
});

test.each([0, -1, 320.5, NaN, Infinity])(
  'rejects invalid dimensions %s',
  async (value) => {
    await expect(page.viewport(value, 480)).rejects.toThrow('positive integer');
    await expect(page.viewport(640, value)).rejects.toThrow('positive integer');
  },
);

test.concurrent('rejects resizing in concurrent tests', async () => {
  await expect(page.viewport(640, 480)).rejects.toThrow('concurrent tests');
});

const fixtureTest = test.extend<{ viewportFixture: void }>({
  viewportFixture: async ({ expect: fixtureExpect }, use) => {
    await use();
    fixtureExpect(window.innerWidth).toBe(680);
  },
});

fixtureTest(
  'keeps the viewport through fixture cleanup',
  async ({ viewportFixture }) => {
    void viewportFixture;
    await page.viewport(680, 480);
  },
);

test('serializes overlapping reset and resize requests', async () => {
  await page.viewport(800, 600);
  await Promise.all([page.viewport(390, 844), page.viewport(900, 700)]);
  expect(window.innerWidth).toBe(900);
  expect(window.innerHeight).toBe(700);
});

test('supports dimensions beyond the interactive UI limits', async () => {
  await page.viewport(10001, 600);
  expect(window.innerWidth).toBe(10001);
});

describe.concurrent('concurrent suite hooks', () => {
  beforeAll(async () => {
    await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
  });
  test('keeps the default viewport', () => {
    expect(window.innerWidth).toBe(390);
  });
});

let startCase: () => void;
let releaseCase: () => void;
let finishCase: () => void;
const caseStarted = new Promise<void>((resolve) => {
  startCase = resolve;
});
const caseReleased = new Promise<void>((resolve) => {
  releaseCase = resolve;
});
const caseFinished = new Promise<void>((resolve) => {
  finishCase = resolve;
});

test.concurrent(
  'rejects resizing while a sibling suite hook is active',
  async () => {
    startCase();
    await caseReleased;
    try {
      await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
    } finally {
      finishCase();
    }
  },
);

describe.concurrent('overlapping suite', () => {
  beforeAll(async () => {
    await caseStarted;
    releaseCase();
    await caseFinished;
  });
  test('keeps the shared viewport unchanged', () => {
    expect(window.innerWidth).toBe(390);
  });
});

test('restores after overlapping viewport requests', () => {
  expect(window.innerWidth).toBe(390);
  expect(window.innerHeight).toBe(844);
});

describe('serial suite with concurrent children', () => {
  beforeAll(async () => {
    await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
    return async () => {
      await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
    };
  });
  afterAll(async () => {
    await expect(page.viewport(700, 500)).rejects.toThrow('concurrent tests');
  });
  test('still allows serial tests to resize', async () => {
    await page.viewport(700, 500);
    expect(window.innerWidth).toBe(700);
  });
  test.concurrent('keeps concurrent tests at the default size', () => {
    expect(window.innerWidth).toBe(390);
  });
});

describe('serial suite teardown', () => {
  afterAll(async () => {
    await page.viewport(710, 510);
  });
  test('runs at the default size', () => {
    expect(window.innerWidth).toBe(390);
  });
});

describe('concurrent tests after serial suite teardown', () => {
  test.concurrent('starts at the default size', () => {
    expect(window.innerWidth).toBe(390);
  });
  test.concurrent('also starts at the default size', () => {
    expect(window.innerWidth).toBe(390);
  });
});

describe('serial suite returned cleanup', () => {
  beforeAll(() => async () => {
    await page.viewport(720, 520);
  });
  test('runs at the default size', () => {
    expect(window.innerWidth).toBe(390);
  });
});

test('restores after suite cleanup', () => {
  expect(window.innerWidth).toBe(390);
});

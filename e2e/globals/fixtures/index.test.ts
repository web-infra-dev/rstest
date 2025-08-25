beforeAll(() => {
  console.log('[beforeAll]');
});

afterAll(() => {
  console.log('[afterAll]');
});

beforeEach(() => {
  console.log('[beforeEach]');
});

afterEach(() => {
  console.log('[afterEach]');
});

describe('Index', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
    expect(rstest.fn).toBeDefined();
  });
});

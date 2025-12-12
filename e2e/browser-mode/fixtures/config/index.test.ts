// @ts-expect-error - @test-alias is defined via resolve.alias in rstest.config.ts
import { ALIASED_VALUE } from '@test-alias';

// This test uses globals: true config
describe('globals config', () => {
  it('should have global describe and it', () => {
    // If this runs, globals are working
    expect(typeof describe).toBe('function');
    expect(typeof it).toBe('function');
    expect(typeof expect).toBe('function');
  });

  it('should have browser globals', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
    expect(typeof navigator).toBe('object');
  });
});

describe('rsbuild config options', () => {
  it('should support source.define', () => {
    // @ts-expect-error - __TEST_DEFINE__ is defined via source.define in rstest.config.ts
    expect(__TEST_DEFINE__).toBe('define-value');
  });

  it('should support resolve.alias', () => {
    expect(ALIASED_VALUE).toBe('aliased-module-works');
  });
});

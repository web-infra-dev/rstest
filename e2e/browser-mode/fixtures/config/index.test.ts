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

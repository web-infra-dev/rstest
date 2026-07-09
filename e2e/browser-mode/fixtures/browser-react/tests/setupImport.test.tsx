import { describe, expect, it } from '@rstest/core';
import '@testing-library/react';

describe('browser react setup import', () => {
  it('loads testing library react after setup files', () => {
    expect(1).toBe(1);
  });
});

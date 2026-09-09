import { describe, expect, it } from '@rstest/core';
import { isPositiveFiniteSize, selectionFromConfig } from './viewport';

describe('isPositiveFiniteSize', () => {
  it('accepts two finite, strictly positive dimensions', () => {
    expect(isPositiveFiniteSize(800, 600)).toBe(true);
  });

  it('rejects zero, negative, NaN and Infinity on either axis', () => {
    expect(isPositiveFiniteSize(0, 600)).toBe(false);
    expect(isPositiveFiniteSize(-1, 600)).toBe(false);
    expect(isPositiveFiniteSize(Number.NaN, 600)).toBe(false);
    expect(isPositiveFiniteSize(Number.POSITIVE_INFINITY, 600)).toBe(false);
    expect(isPositiveFiniteSize(800, 0)).toBe(false);
    expect(isPositiveFiniteSize(800, -1)).toBe(false);
    expect(isPositiveFiniteSize(800, Number.NaN)).toBe(false);
    expect(isPositiveFiniteSize(800, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('selectionFromConfig', () => {
  it('defaults to full when no viewport is configured', () => {
    expect(selectionFromConfig(undefined)).toEqual({ mode: 'full' });
  });

  it('decodes a valid responsive object', () => {
    expect(selectionFromConfig({ width: 800, height: 600 })).toEqual({
      mode: 'responsive',
      width: 800,
      height: 600,
    });
  });

  it('falls back to full for non-positive / non-finite dimensions', () => {
    expect(selectionFromConfig({ width: 0, height: 600 })).toEqual({
      mode: 'full',
    });
    expect(selectionFromConfig({ width: -1, height: 600 })).toEqual({
      mode: 'full',
    });
    expect(selectionFromConfig({ width: Number.NaN, height: 600 })).toEqual({
      mode: 'full',
    });
    expect(
      selectionFromConfig({ width: Number.POSITIVE_INFINITY, height: 600 }),
    ).toEqual({ mode: 'full' });
  });
});

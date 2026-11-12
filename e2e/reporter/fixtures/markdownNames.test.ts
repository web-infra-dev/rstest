import { describe, expect, it } from '@rstest/core';

let attempts = 0;

describe('<Button />', () => {
  it('renders `children` in *bold*', () => {
    expect('<b>Save</b>').toBe('<strong>Save</strong>');
  });

  it('returns `undefined`', () => {
    attempts += 1;
    expect(attempts).toBe(2);
  });
});

import { describe, expect, it } from '@rstest/core';

describe('Project A - Form Tests', () => {
  it('creates a form element', () => {
    const form = document.createElement('form');
    form.id = 'test-form-a';
    document.body.appendChild(form);
    expect(document.getElementById('test-form-a')).toBe(form);
  });

  it('adds input to form', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'username';
    form.appendChild(input);
    expect(form.elements.namedItem('username')).toBe(input);
  });
});

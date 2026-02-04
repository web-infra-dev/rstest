import { describe, expect, it } from '@rstest/core';
import { page } from '../src/client/locator';

describe('browser locator IR', () => {
  it('should expose query-only page entry', () => {
    expect((page as any).click).toBeUndefined();
    expect((page as any).fill).toBeUndefined();

    const locator = page.getByRole('button', { name: 'Submit' });
    expect((locator.ir.steps[0] as any).type).toBe('getByRole');
  });

  it('should build nested filter({ has }) IR', () => {
    const base = page.locator('section');
    const has = page.locator('h2').filter({ hasText: 'Profile' });
    const out = base.filter({ has });

    expect(out.ir.steps.length).toBe(2);
    const step: any = out.ir.steps[1];
    expect(step.type).toBe('filter');
    expect(step.options.has).toBeDefined();
    expect(step.options.has.steps[0].type).toBe('locator');
    expect(step.options.has.steps[1].type).toBe('filter');
  });

  it('should build and/or IR with nested locators', () => {
    const a = page.locator('button');
    const b = page.getByText('Increment');
    const c = page.getByText('Cancel');

    const out = a.and(b).or(c);
    expect(out.ir.steps.length).toBe(3);
    expect((out.ir.steps[1] as any).type).toBe('and');
    expect((out.ir.steps[2] as any).type).toBe('or');
    expect((out.ir.steps[1] as any).locator.steps.length).toBeGreaterThan(0);
    expect((out.ir.steps[2] as any).locator.steps.length).toBeGreaterThan(0);
  });

  it('should allow composing has locator with and/or', () => {
    const has = page
      .getByText('Profile')
      .or(page.getByText('Settings'))
      .and(page.locator('h2'));

    const out = page.locator('section').filter({ has });
    const step: any = out.ir.steps[1];
    expect(step.type).toBe('filter');
    expect(step.options.has).toBeDefined();
    const hasSteps = step.options.has.steps as any[];
    expect(hasSteps.some((s) => s.type === 'or')).toBe(true);
    expect(hasSteps.some((s) => s.type === 'and')).toBe(true);
  });
});

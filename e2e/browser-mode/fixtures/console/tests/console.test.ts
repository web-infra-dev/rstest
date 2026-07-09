import { describe, expect, it } from '@rstest/core';

describe('console forwarding', () => {
  it('should forward console.log', () => {
    console.log('CONSOLE_LOG_TEST_MESSAGE');
    expect(true).toBe(true);
  });

  it('should forward console.info', () => {
    console.info('CONSOLE_INFO_TEST_MESSAGE');
    expect(true).toBe(true);
  });

  it('should forward console.warn', () => {
    console.warn('CONSOLE_WARN_TEST_MESSAGE');
    expect(true).toBe(true);
  });

  it('should forward console.error', () => {
    console.error('CONSOLE_ERROR_TEST_MESSAGE');
    expect(true).toBe(true);
  });

  it('should forward console.debug', () => {
    console.debug('CONSOLE_DEBUG_TEST_MESSAGE');
    expect(true).toBe(true);
  });

  it('should forward multiple arguments', () => {
    console.log('MULTI_ARG_TEST', 'arg1', 'arg2', 123);
    expect(true).toBe(true);
  });

  it('should forward object arguments', () => {
    console.log('OBJECT_TEST', { key: 'value', nested: { a: 1 } });
    expect(true).toBe(true);
  });

  it('should forward array arguments', () => {
    console.log('ARRAY_TEST', [1, 2, 3, 'four']);
    expect(true).toBe(true);
  });
});

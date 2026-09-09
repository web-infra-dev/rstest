import { test } from '@rstest/core';

const extend = test.extend as (...args: unknown[]) => unknown;
extend('base-url', 'https://example.com');

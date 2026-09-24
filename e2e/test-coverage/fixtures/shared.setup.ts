import { expect } from '@rstest/core';
import { sayHi } from './src/index';

expect(sayHi()).toBe('hi');

// @ts-expect-error: the package is alongside, only for testing purposes
import { a } from 'test-module-field';

const { a: b } = require('test-module-field');

export { a, b };

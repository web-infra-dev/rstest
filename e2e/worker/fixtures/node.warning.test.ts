import { EventEmitter } from 'node:events';
import { describe, expect, it } from '@rstest/core';

const eventEmitter = new EventEmitter();

for (let i = 0; i < 11; i++) {
  eventEmitter.on('', () => {});
}

describe('Index', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });
});

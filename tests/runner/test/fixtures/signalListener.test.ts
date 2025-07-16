import { expect, it } from '@rstest/core';

process.on('SIGTERM', () => {
  console.log('SIGTERM received');
});

process.on('SIGINT', () => {
  console.log('SIGINT received');
});

process.on('exit', () => {
  console.log('exit received');
});

it('should add two numbers correctly', () => {
  expect(1 + 1).toBe(2);
});

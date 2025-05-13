import { test } from '@rstest/core';

test('log output', () => {
  console.log("I'm log");
});

test('warn output', () => {
  console.warn("I'm warn");
});

test('error output', () => {
  console.error("I'm error");
});

test('info output', () => {
  console.info("I'm info");
});

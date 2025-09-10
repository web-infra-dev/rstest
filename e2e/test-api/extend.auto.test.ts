import { afterAll, expect, test } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  // should init on demand
  expect(logs.length).toBe(4);
});

const todos: number[] = [];
const archive: number[] = [];

const myTest = test.extend<{
  todos: number[];
  archive: number[];
}>({
  todos: [
    async (_, use) => {
      logs.push('init todos');
      todos.push(1, 2, 3);
      await use(todos);
      // cleanup after each test function
      todos.length = 0;
    },
    {
      auto: true,
    },
  ],
  archive: [
    async (_, use) => {
      logs.push('init archive');
      await use(archive);
      // cleanup after each test function
      archive.length = 0;
    },
    {
      auto: true,
    },
  ],
});

myTest('add todo', ({ todos }) => {
  expect(todos.length).toBe(3);

  todos.push(4);
  expect(todos.length).toBe(4);
});

myTest('add archive', ({ archive }) => {
  expect(archive.length).toBe(0);

  archive.push(1, 2);
  expect(archive.length).toBe(2);
});

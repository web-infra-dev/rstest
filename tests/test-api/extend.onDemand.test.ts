import { afterAll, expect, test } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  // should init on demand
  expect(logs.length).toBe(3);
});

const todos: number[] = [];

const myTest = test.extend<{
  todos: number[];
  archive: number[];
}>({
  todos: async (_, use) => {
    logs.push('init todos');
    await new Promise((resolve) => setTimeout(resolve, 10));
    todos.push(1, 2, 3);
    await use(todos);
    // cleanup after each test function
    todos.length = 0;
  },
  archive: [],
});

myTest('add todo 1', ({ todos }) => {
  expect(todos.length).toBe(3);

  todos.push(4);
  expect(todos.length).toBe(4);
});

myTest('add todo 2', ({ todos }) => {
  expect(todos.length).toBe(3);

  todos.push(4, 5);
  expect(todos.length).toBe(5);
});

myTest.fails('add todo 3 - failed', ({ todos }) => {
  expect(todos.length).toBe(3);

  todos.push(4, 5);
  expect(todos.length).toBe(6);
});

myTest('add archive', ({ archive }) => {
  expect(archive.length).toBe(0);

  archive.push(1, 2);
  expect(archive.length).toBe(2);
});

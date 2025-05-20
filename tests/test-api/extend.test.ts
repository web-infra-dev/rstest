import { expect, test } from '@rstest/core';

const todos: number[] = [];

const myTest = test.extend<{
  todos: number[];
}>({
  todos: async (_, use) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    todos.push(1, 2, 3);
    await use(todos);
    // cleanup after each test function
    todos.length = 0;
  },
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

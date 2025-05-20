import { expect, test } from '@rstest/core';

const todos: number[] = [];
const archive: number[] = [];

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

const myTest1 = myTest.extend<{
  archive: number[];
}>({
  archive: async (_, use) => {
    archive.push(1, 2, 3);
    await use(archive);
    // cleanup after each test function
    archive.length = 0;
  },
});

myTest1('add todo', ({ todos }) => {
  expect(todos.length).toBe(3);

  todos.push(4);
  expect(todos.length).toBe(4);
});

myTest1('add archive', ({ todos }) => {
  expect(archive.length).toBe(3);

  archive.push(4, 5);
  expect(archive.length).toBe(5);
});

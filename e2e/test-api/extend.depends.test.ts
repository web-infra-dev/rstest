import { afterAll, expect, test } from '@rstest/core';

const todos: number[] = [];
const archive: number[] = [];

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual(['clean getList', 'clean archive', 'clean todos']);
});

const myTest = test.extend<{
  todos: number[];
  archive: number[];
  getList: () => {
    todos: number[];
    archive: number[];
  };
}>({
  todos: async (_, use) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    todos.push(1, 2, 3);
    await use(todos);
    logs.push('clean todos');
    // cleanup after each test function
    todos.length = 0;
  },
  archive: async (_, use) => {
    archive.push(1, 2, 3);
    await use(archive);
    logs.push('clean archive');
    // cleanup after each test function
    archive.length = 0;
  },
  getList: async ({ todos, archive }, use) => {
    await use(() => ({ todos, archive }));
    logs.push('clean getList');
  },
});

myTest('add todo', ({ getList }) => {
  expect(getList()).toEqual({
    todos: [1, 2, 3],
    archive: [1, 2, 3],
  });
});

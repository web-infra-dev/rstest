import { afterAll, expect, test } from '@rstest/core';

afterAll(() => {
  console.log('[lifecycle] afterAll');
});

interface Db {
  rows: string[];
}

const fileTest = test
  .extend('db', { scope: 'file' }, async (_, { onCleanup }) => {
    console.log('[lifecycle] setup db');
    const db: Db = { rows: [] };
    onCleanup(() => {
      console.log('[lifecycle] cleanup db');
    });
    return db;
  })
  .extend('counter', async (_, { onCleanup }) => {
    console.log('[lifecycle] setup counter');
    const counter: number[] = [];
    onCleanup(() => {
      console.log('[lifecycle] cleanup counter');
    });
    return counter;
  });

fileTest('first test', ({ db, counter }) => {
  db.rows.push('a');
  counter.push(1);
  expect(db.rows).toEqual(['a']);
  expect(counter).toEqual([1]);
});

fileTest('second test sees shared db', ({ db, counter }) => {
  db.rows.push('b');
  expect(db.rows).toEqual(['a', 'b']);
  counter.push(2);
  expect(counter).toEqual([2]);
});

fileTest('third test still sees shared db', ({ db }) => {
  db.rows.push('c');
  expect(db.rows).toEqual(['a', 'b', 'c']);
});

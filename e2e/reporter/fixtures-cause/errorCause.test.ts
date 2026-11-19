import { it } from '@rstest/core';

const connect = () => {
  throw new Error('Database connection refused');
};

const request = () => {
  try {
    connect();
  } catch (error) {
    throw new TypeError('fetch failed', { cause: error });
  }
};

const loadUser = () => {
  try {
    request();
  } catch (error) {
    throw new Error('Failed to load user', { cause: error });
  }
};

it('loads the user', () => {
  loadUser();
});

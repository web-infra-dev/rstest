import { describe, it } from '@rstest/core';

const connect = () => {
  throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
};

const loadUser = () => {
  try {
    connect();
  } catch (error) {
    throw new Error('Failed to load user', { cause: error });
  }
};

describe('agent-md', () => {
  it('fails with an error cause', () => {
    loadUser();
  });
});

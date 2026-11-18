import { describe, it } from '@rstest/core';

const connect = () => {
  throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
};

describe('agent-md', () => {
  it('connects to the database', () => {
    connect();
  });
});

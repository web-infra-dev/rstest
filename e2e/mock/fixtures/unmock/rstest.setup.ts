// import { rs } from '@rstest/core';

process.env.NODE_ENV = 'rstest:production';

rs.mock('node:crypto', () => {
  return {
    randomFill: 'mocked_randomFill',
  };
});

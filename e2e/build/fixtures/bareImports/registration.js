import { rs } from '@rstest/core';
rs.mock('./answer.js', () => ({ answer: () => 'test mock' }));

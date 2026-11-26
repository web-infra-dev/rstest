import { rs } from '@rstest/core';
import { state } from './state.js';
state.setupRuns++;
rs.mock('./setup-answer.js', () => ({ setupAnswer: () => 'setup mock' }));

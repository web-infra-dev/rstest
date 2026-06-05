import { describe, expect, it } from '@rstest/core';
import { buildScenarioPlan, groupScenarioRecords } from '../src';

describe('compile graph plan', () => {
  it('groups records into stable buckets', () => {
    expect(groupScenarioRecords()).toEqual([
      {
        bucket: 'entry',
        names: ['compile graph', 'mock tracker', 'snapshot formatter'],
        totalDependencies: 7,
        totalReachableModules: 9,
      },
      {
        bucket: 'branch',
        names: ['list collector', 'runtime hooks'],
        totalDependencies: 2,
        totalReachableModules: 2,
      },
      {
        bucket: 'leaf',
        names: ['module cache'],
        totalDependencies: 0,
        totalReachableModules: 0,
      },
    ]);
  });

  it('renders the sorted plan summary', () => {
    expect(buildScenarioPlan()).toEqual([
      'entry:7:9:compile graph|mock tracker|snapshot formatter',
      'branch:2:2:list collector|runtime hooks',
      'leaf:0:0:module cache',
    ]);
  });
});

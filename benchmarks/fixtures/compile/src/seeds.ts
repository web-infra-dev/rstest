import type { ScenarioSeed } from './types';

export const scenarioSeeds: ScenarioSeed[] = [
  {
    name: 'compile graph',
    imports: ['list collector', 'module cache', 'snapshot formatter'],
  },
  { name: 'runtime hooks', imports: ['module cache'] },
  { name: 'mock tracker', imports: ['runtime hooks', 'module cache'] },
  { name: 'list collector', imports: ['module cache'] },
  {
    name: 'snapshot formatter',
    imports: ['list collector', 'runtime hooks'],
  },
  { name: 'module cache', imports: [] },
];

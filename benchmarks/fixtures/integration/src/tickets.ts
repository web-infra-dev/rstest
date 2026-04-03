import type { Ticket } from './types';

export const tickets: Ticket[] = [
  {
    id: 'core-cache',
    owner: 'Mina',
    severity: 'high',
    customerFacing: true,
    tags: ['core', 'cache'],
  },
  {
    id: 'runner-hooks',
    owner: 'Noah',
    severity: 'medium',
    customerFacing: false,
    tags: ['runner', 'lifecycle'],
  },
  {
    id: 'snapshot-md',
    owner: 'Mina',
    severity: 'low',
    customerFacing: true,
    tags: ['reporter', 'snapshot'],
  },
  {
    id: 'cli-shard',
    owner: 'Kai',
    severity: 'medium',
    customerFacing: true,
    tags: ['cli', 'shard', 'core'],
  },
  {
    id: 'browser-channel',
    owner: 'Noah',
    severity: 'high',
    customerFacing: true,
    tags: ['browser', 'rpc'],
  },
  {
    id: 'coverage-html',
    owner: 'June',
    severity: 'low',
    customerFacing: false,
    tags: ['coverage', 'reporter'],
  },
];

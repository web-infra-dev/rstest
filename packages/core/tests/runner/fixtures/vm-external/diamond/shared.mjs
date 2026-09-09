import path from 'node:path';

export const shared = typeof path.join === 'function';

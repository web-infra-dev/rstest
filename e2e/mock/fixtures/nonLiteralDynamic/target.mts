import { hostname } from 'node:os';

export const probe = (): string => hostname();

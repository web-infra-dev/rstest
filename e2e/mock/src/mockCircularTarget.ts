import { getValue } from './mockCircularDependency';

export const value = 'target';
export const result = getValue();

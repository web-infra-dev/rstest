// Intermediate module: captures `dep` in its closure at evaluation time.
import { value } from './dep';

export const getValue = (): string => value();

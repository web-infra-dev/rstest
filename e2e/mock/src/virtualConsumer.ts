// @ts-expect-error The module is supplied by the test's mock factory at runtime.
import { value } from 'virtual-dependency';

export const readVirtualValue = (): string => value;

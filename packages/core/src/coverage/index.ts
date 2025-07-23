import type { CoverageOptions } from '../types/coverage';
import type { CoverageProvider } from './istanbul';
import { IstanbulCoverageProvider } from './istanbul';

export function createCoverageProvider(
  options: CoverageOptions,
): CoverageProvider | null {
  if (!options.enabled) {
    return null;
  }

  switch (options.provider) {
    case 'istanbul':
      return new IstanbulCoverageProvider();
    case 'v8':
      // TODO: Implement V8 coverage collector
      throw new Error('V8 coverage provider is not implemented yet');
    default:
      return new IstanbulCoverageProvider();
  }
}

export type { CoverageProvider } from './istanbul';

export const coverageProviders = ['istanbul', 'v8'] as const;

export type CoverageProvider = (typeof coverageProviders)[number];

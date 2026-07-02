// Mocked with an ASYNC factory. The synchronous native load hook cannot produce
// async exports, so a natively-loaded importer must fall through to THIS real
// module (not an empty synthetic one). See mockNonLiteralDynamicImport.test.ts.
export const value = 'REAL_ASYNC';

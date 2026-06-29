// Evaluated once per worker under `isolate: false`. When its source changes in
// watch mode, the rerun must observe the NEW value, not the previous build's
// cached evaluation in the kept runtime chunk.
export const marker = 'ORIGINAL';

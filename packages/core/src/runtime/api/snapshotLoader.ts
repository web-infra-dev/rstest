/**
 * Compat path (browser runtime): the snapshot client stays in its own lazy
 * chunk so the browser runtime entry keeps its size. The Node worker build
 * aliases this module to `./snapshotLoader.worker`, which bundles it into the
 * worker's single startup chunk.
 */
export const loadSnapshotModule = (): Promise<typeof import('./snapshot')> =>
  import(/* webpackChunkName: "snapshot" */ './snapshot');

export type MaybePromise<T> = T | Promise<T>;

export type FunctionLike = (...args: any) => any;

/** The test file output path */
export type DistPath = string;
/** The test original path */
export type TestPath = string;

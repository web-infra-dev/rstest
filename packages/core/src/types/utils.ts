export type MaybePromise<T> = T | Promise<T>;

export type FunctionLike = (...args: any) => any;

/** The test file output path */
export type DistPath = string;
/** The test file original path */
export type TestPath = string;

/** The stdio stream a console log was written to */
export type ConsoleStreamType = 'stdout' | 'stderr';

export type Falsy = false | 0 | 0n | '' | null | undefined;
export type Truthy<T> = Exclude<T, Falsy>;

/**
 * The uncovered path is a statement rather than a ternary arm: under CommonJS
 * output the v8 provider reports a ternary as fully covered, which would make
 * the 100% threshold reachable and silently void this fixture.
 */
export const classify = (n: number): string => {
  if (n > 0) {
    return 'positive';
  }
  return 'non-positive';
};

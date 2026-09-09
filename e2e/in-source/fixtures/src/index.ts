export const sayHi = () => 'hi';

const workerGlobal = globalThis as typeof globalThis & {
  __inSourceEvaluationCount?: number;
};
const evaluationCount = (workerGlobal.__inSourceEvaluationCount ?? 0) + 1;
workerGlobal.__inSourceEvaluationCount = evaluationCount;

export const getEvaluationCount = () => evaluationCount;

if (import.meta.rstest) {
  const { it, expect } = import.meta.rstest;
  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
    expect(getEvaluationCount()).toBeLessThanOrEqual(2);
  });
}

export const summarizeScores = (scores: number[]) => {
  const total = scores.reduce((sum, value) => sum + value, 0);
  const average = scores.length ? total / scores.length : 0;
  const weightedTotal = total + average * 0.25;
  const label = `${scores.length}-scores`;

  return {
    total,
    average,
    weightedTotal,
    label,
  };
};

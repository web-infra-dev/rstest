await Promise.resolve();

export const state = {
  firstFinished: false,
  secondFinished: false,
  overlap: false,
};
export let signalSecond: () => void;
export const secondStarted = new Promise<void>((resolve) => {
  signalSecond = resolve;
});

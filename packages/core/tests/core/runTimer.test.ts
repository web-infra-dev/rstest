import { expect, it, rs } from '@rstest/core';
import { RunTimer } from '../../src/core/execution/runTimer';

it('counts overlapping test groups and the time after the last build', () => {
  let now = 0;
  const clock = rs.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const timer = new RunTimer();
    now = 10;
    const finishFirst = timer.startTestGroup();
    now = 15;
    const finishSecond = timer.startTestGroup();
    now = 25;
    finishFirst?.();
    now = 30;
    finishSecond?.();

    now = 55;
    const finishLast = timer.startTestGroup();
    now = 65;
    timer.finishBuild();
    now = 75;
    const finishAfterBuild = timer.startTestGroup();
    now = 90;
    finishLast?.();
    now = 95;
    finishAfterBuild?.();
    now = 100;

    expect(timer.finish()).toEqual({
      buildTime: 65,
      testTime: 65,
      totalTime: 100,
    });
  } finally {
    clock.mockRestore();
  }
});

it.for([false, true])(
  'attributes time after build completion when a test group starts: %s',
  (startsTests) => {
    let now = 0;
    const clock = rs.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const timer = new RunTimer();
      now = 20;
      timer.finishBuild();
      if (startsTests) {
        now = 25;
        timer.startTestGroup();
      }
      now = 40;
      expect(timer.finish()).toEqual({
        totalTime: 40,
        buildTime: startsTests ? 20 : 40,
        testTime: startsTests ? 20 : 0,
      });
    } finally {
      clock.mockRestore();
    }
  },
);

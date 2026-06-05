import { setRealTimers } from '../../../src/runtime/util';
import { createUtilities } from './helpers';

describe('fake timers API', () => {
  beforeEach(() => {
    setRealTimers();
  });

  it('useFakeTimers not throws when specifies `toNotFake`', async () => {
    const rs = await createUtilities();

    expect(() =>
      rs.useFakeTimers({ toNotFake: ['setImmediate'] }),
    ).not.toThrow();

    rs.useRealTimers();
  });

  it('useFakeTimers filters out timers in toNotFake', async () => {
    const rs = await createUtilities();

    rs.useFakeTimers({ toNotFake: ['setTimeout'] });

    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5);

    rs.advanceTimersByTime(10); // proves that setTimeout is not mocked
    expect(fired).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fired).toBe(true);

    rs.useRealTimers();
  });
});

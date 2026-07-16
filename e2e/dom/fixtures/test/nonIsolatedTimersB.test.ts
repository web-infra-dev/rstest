import { it } from '@rstest/core';
import { runTimerPhase } from './nonIsolatedTimers';

it('keeps the current environment timer wrappers', runTimerPhase);

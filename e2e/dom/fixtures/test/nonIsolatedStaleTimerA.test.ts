import { it } from '@rstest/core';
import { runStaleTimerPhase } from './nonIsolatedStaleTimer';

it('retains a timer wrapper from the first environment', runStaleTimerPhase);

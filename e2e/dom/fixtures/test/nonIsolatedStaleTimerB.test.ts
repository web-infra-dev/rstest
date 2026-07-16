import { it } from '@rstest/core';
import { runStaleTimerPhase } from './nonIsolatedStaleTimer';

it('reports errors from the retained timer wrapper', runStaleTimerPhase);

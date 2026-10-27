import type { TypecheckHostModule } from '@rstest/core/internal/typecheck';
import { createTypecheckExecutor } from './executor';

export { createTypecheckExecutor };

void ({ createTypecheckExecutor } satisfies TypecheckHostModule);

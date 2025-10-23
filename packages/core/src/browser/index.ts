import type { Rstest } from '../core/rstest';
import { runBrowserController } from './hostController';

export async function runBrowserTests(context: Rstest): Promise<void> {
  await runBrowserController(context);
}

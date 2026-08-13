import { access } from 'node:fs/promises';
import { projectAFinishedMarker } from './marker';

export default async function waitForProjectA() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await access(projectAFinishedMarker);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('Timed out waiting for project A to finish');
}

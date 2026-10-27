import { expect, test } from '@rstest/core';
import { BroadcastChannel } from 'node:worker_threads';

// jsdom 30 depends on undici 8, which no longer touches any global while it
// loads. Node's bundled undici is therefore first initialized by the
// environment setup itself, after `Event` has been replaced, unless the
// originals are captured before any override.
test('Node BroadcastChannel delivers messages under jsdom', async () => {
  const sender = new BroadcastChannel('rstest-broadcast-channel');
  const receiver = new BroadcastChannel('rstest-broadcast-channel');
  const received = new Promise<unknown>((resolve) => {
    receiver.onmessage = (event) => resolve(event.data);
  });

  sender.postMessage('hi');

  await expect(received).resolves.toBe('hi');
  sender.close();
  receiver.close();
});

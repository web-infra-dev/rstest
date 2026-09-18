import { EventEmitter } from 'node:events';
import { wrapRpc } from '../../../../src/pool/protocol';
import { ForksChannel } from '../../../../src/runtime/worker/channels/forksChannel';

type SendCallback = (error: Error | null) => void;

const createProcessSend = (
  send: (callback: SendCallback) => void,
): NonNullable<typeof process.send> =>
  ((_message: unknown, callback?: SendCallback) => {
    send(callback!);
    return true;
  }) as NonNullable<typeof process.send>;

describe('ForksChannel', () => {
  it('waits for pending process.send callbacks', async () => {
    const callbacks: SendCallback[] = [];
    const source = Object.assign(new EventEmitter(), {
      send: createProcessSend((callback) => callbacks.push(callback)),
    });
    const channel = new ForksChannel(source);

    channel.send(wrapRpc('first'));
    channel.send(wrapRpc('second'));

    let drained = false;
    const drain = channel.waitForPendingWrites().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    callbacks.shift()!(null);
    await Promise.resolve();
    expect(drained).toBe(false);

    callbacks.shift()!(null);
    await drain;
    expect(drained).toBe(true);
    expect(source.listenerCount('disconnect')).toBe(0);
  });

  it('stops waiting when the IPC channel disconnects', async () => {
    const source = Object.assign(new EventEmitter(), {
      send: createProcessSend(() => {}),
    });
    const channel = new ForksChannel(source);

    channel.send(wrapRpc('message'));
    const drain = channel.waitForPendingWrites();

    source.emit('disconnect');

    await expect(drain).resolves.toBeUndefined();
    expect(source.listenerCount('disconnect')).toBe(0);
  });
});

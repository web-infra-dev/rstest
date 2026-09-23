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

const createSource = ({
  connected = true,
  send,
}: {
  connected?: boolean;
  send: NonNullable<typeof process.send>;
}) => Object.assign(new EventEmitter(), { connected, send });

describe('ForksChannel', () => {
  it('waits for pending process.send callbacks', async () => {
    const callbacks: SendCallback[] = [];
    const source = createSource({
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
    const source = createSource({ send: createProcessSend(() => {}) });
    const channel = new ForksChannel(source);

    channel.send(wrapRpc('message'));
    const drain = channel.waitForPendingWrites();

    source.emit('disconnect');

    await expect(drain).resolves.toBeUndefined();
    expect(source.listenerCount('disconnect')).toBe(0);
  });

  it('reports a failed write while connected to onLostWrite', async () => {
    const lostWriteError = new Error('write UNKNOWN');
    const channel = new ForksChannel(
      createSource({
        send: createProcessSend((callback) => callback(lostWriteError)),
      }),
    );
    const onLostWrite = rs.fn();
    channel.onLostWrite = onLostWrite;

    channel.send(wrapRpc('message'));

    expect(onLostWrite).toHaveBeenCalledTimes(1);
    expect(onLostWrite).toHaveBeenCalledWith(lostWriteError);
    await expect(channel.waitForPendingWrites()).resolves.toBeUndefined();
  });

  it('reports a synchronous send throw while connected to onLostWrite', () => {
    const channel = new ForksChannel(
      createSource({
        send: createProcessSend(() => {
          throw new Error('could not be cloned');
        }),
      }),
    );
    const onLostWrite = rs.fn();
    channel.onLostWrite = onLostWrite;

    channel.send(wrapRpc('message'));

    expect(onLostWrite).toHaveBeenCalledTimes(1);
  });

  it('ignores a failed write once disconnected', () => {
    const channel = new ForksChannel(
      createSource({
        connected: false,
        send: createProcessSend((callback) =>
          callback(new Error('write UNKNOWN')),
        ),
      }),
    );
    const onLostWrite = rs.fn();
    channel.onLostWrite = onLostWrite;

    channel.send(wrapRpc('message'));

    expect(onLostWrite).not.toHaveBeenCalled();
  });
});

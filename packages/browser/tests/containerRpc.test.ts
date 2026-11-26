import type { AddressInfo } from 'node:net';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { createBirpc } from 'birpc';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ContainerRpcHub,
  type ContainerRpcMethods,
  type HostRpcMethods,
} from '../src/containerRpc';

const startWsServer = async (): Promise<{
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
}> => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const port = (wss.address() as AddressInfo).port;
  return {
    wss,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close(() => resolve());
      }),
  };
};

const connectClient = async (
  port: number,
  containerId?: string,
  containerMethods: Partial<ContainerRpcMethods> = {},
) => {
  const url = containerId
    ? `ws://127.0.0.1:${port}/?containerId=${encodeURIComponent(containerId)}`
    : `ws://127.0.0.1:${port}`;
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const rpc = createBirpc<HostRpcMethods, ContainerRpcMethods>(
    {
      onTestFileUpdate: async () => {},
      reloadTestFile: async () => {},
      onHostConfigUpdate: async () => {},
      ...containerMethods,
    },
    {
      timeout: 5_000,
      post: (data) => ws.send(JSON.stringify(data)),
      on: (fn) => {
        ws.on('message', (msg) => fn(JSON.parse(msg.toString())));
      },
    },
  );
  return {
    ws,
    rpc,
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
};

const makeHostMethods = (label: string): HostRpcMethods => ({
  rerunTest: async () => {},
  getTestFiles: async () => ({
    files: [{ testPath: `/${label}.test.ts`, projectName: label }],
    version: 1,
  }),
  onFrameSetReady: async () => {},
  dispatch: async (req) => ({ requestId: req.requestId, result: label }),
});

describe('ContainerRpcHub', () => {
  it('multiplexes multiple headed containers independently without evicting siblings', async () => {
    const server = await startWsServer();
    onTestFinished(() => server.close());

    const hub = new ContainerRpcHub(server.wss);
    const epochsA: number[] = [];
    const epochsB: number[] = [];
    const disconnectsA: Error[] = [];
    const disconnectsB: Error[] = [];

    const sessionA = hub.register(
      'web (chromium)',
      makeHostMethods('chromium'),
      (err) => disconnectsA.push(err),
      (epoch) => epochsA.push(epoch),
    );
    const sessionB = hub.register(
      'web (firefox)',
      makeHostMethods('firefox'),
      (err) => disconnectsB.push(err),
      (epoch) => epochsB.push(epoch),
    );

    const reloadsA: string[] = [];
    const reloadsB: string[] = [];
    const clientA = await connectClient(server.port, 'web (chromium)', {
      reloadTestFile: async (file, runId) => {
        reloadsA.push(`${file}:${runId}`);
      },
    });
    const clientB = await connectClient(server.port, 'web (firefox)', {
      reloadTestFile: async (file, runId) => {
        reloadsB.push(`${file}:${runId}`);
      },
    });
    onTestFinished(async () => {
      await clientA.close();
      await clientB.close();
    });

    // Both containers speak to their own host methods.
    expect(await clientA.rpc.getTestFiles()).toEqual({
      files: [{ testPath: '/chromium.test.ts', projectName: 'chromium' }],
      version: 1,
    });
    expect(await clientB.rpc.getTestFiles()).toEqual({
      files: [{ testPath: '/firefox.test.ts', projectName: 'firefox' }],
      version: 1,
    });

    // Connecting container B did not evict container A or trigger a disconnect.
    expect(sessionA.isConnected).toBe(true);
    expect(sessionB.isConnected).toBe(true);
    expect(epochsA).toEqual([1]);
    expect(epochsB).toEqual([1]);
    expect(disconnectsA).toEqual([]);
    expect(disconnectsB).toEqual([]);

    // Host reloads route strictly to the target container.
    await sessionA.reloadTestFile('/a.test.ts', 'run-a');
    await sessionB.reloadTestFile('/b.test.ts', 'run-b');
    expect(reloadsA).toEqual(['/a.test.ts:run-a']);
    expect(reloadsB).toEqual(['/b.test.ts:run-b']);

    // Reconnecting container A bumps only container A's epoch.
    const clientA2 = await connectClient(server.port, 'web (chromium)');
    onTestFinished(() => clientA2.close());
    await clientA2.rpc.getTestFiles();
    expect(epochsA).toEqual([1, 2]);
    expect(epochsB).toEqual([1]);
    expect(sessionB.isConnected).toBe(true);
  });

  it('attaches a socket that connected before its container session registered', async () => {
    const server = await startWsServer();
    onTestFinished(() => server.close());

    const hub = new ContainerRpcHub(server.wss);
    const client = await connectClient(server.port, 'late-container');
    onTestFinished(() => client.close());

    // Wait a tick for the server-side connection handler to stash the socket.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const session = hub.register('late-container', makeHostMethods('late'));
    expect(session.isConnected).toBe(true);
    expect(await client.rpc.getTestFiles()).toEqual({
      files: [{ testPath: '/late.test.ts', projectName: 'late' }],
      version: 1,
    });
  });

  it('routes a bare connection without containerId to the sole registered session', async () => {
    const server = await startWsServer();
    onTestFinished(() => server.close());

    const hub = new ContainerRpcHub(server.wss);
    hub.register('only-container', makeHostMethods('only'));

    const client = await connectClient(server.port);
    onTestFinished(() => client.close());

    expect(await client.rpc.getTestFiles()).toEqual({
      files: [{ testPath: '/only.test.ts', projectName: 'only' }],
      version: 1,
    });
  });
});

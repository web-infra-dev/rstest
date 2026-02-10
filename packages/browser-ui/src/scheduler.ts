import { type BirpcReturn, createBirpc } from 'birpc';
import {
  forwardPluginRpcRequest,
  forwardSnapshotRpcRequest,
  readDispatchMessage,
} from './core/channel';
import {
  createRunId,
  createRunnerUrl,
  createWebSocketUrl,
  RECONNECT_DELAYS,
} from './core/runtime';
import type {
  BrowserClientFileResult,
  BrowserClientMessage,
  BrowserClientTestResult,
  BrowserHostConfig,
  BrowserPluginRequestMessage,
  ContainerRPC,
  FatalPayload,
  HostRPC,
  LogPayload,
  SnapshotRpcRequest,
  TestFileInfo,
  TestFileStartPayload,
} from './types';
import { getPresetInfo, isDevicePreset } from './utils/viewportPresets';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
  }
}

type SchedulerRpc = BirpcReturn<HostRPC, ContainerRPC>;

const options = window.__RSTEST_BROWSER_OPTIONS__;
const debug = options?.debug === true;
const rpcTimeout = options?.rpcTimeout ?? 30_000;

let rpc: SchedulerRpc | null = null;
let reconnectAttempt = 0;
let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
const iframeMap = new Map<string, HTMLIFrameElement>();
const fileProjectMap = new Map<string, string>();
const runIdMap = new Map<string, string>();

const debugLog = (...args: unknown[]) => {
  if (debug) {
    console.log('[Scheduler]', ...args);
  }
};

const resolveViewport = (
  testFile: string,
): { width: number; height: number } | null => {
  const projectName = fileProjectMap.get(testFile);
  if (!projectName) {
    return null;
  }

  const project = options?.projects.find((item) => item.name === projectName);
  const viewport = project?.viewport;
  if (!viewport) {
    return null;
  }

  if (typeof viewport === 'string' && isDevicePreset(viewport)) {
    const preset = getPresetInfo(viewport);
    return { width: preset.width, height: preset.height };
  }

  if (
    typeof viewport === 'object' &&
    viewport !== null &&
    typeof viewport.width === 'number' &&
    typeof viewport.height === 'number'
  ) {
    return { width: viewport.width, height: viewport.height };
  }

  return null;
};

const postConfig = (frame: HTMLIFrameElement, testFile: string): void => {
  const projectName = fileProjectMap.get(testFile) || '';
  const runId = (() => {
    try {
      return new URL(frame.src).searchParams.get('runId') || '';
    } catch {
      return runIdMap.get(testFile) || '';
    }
  })();
  frame.contentWindow?.postMessage(
    {
      type: 'RSTEST_CONFIG',
      payload: {
        ...options,
        testFile,
        projectName,
        runId,
      },
    },
    '*',
  );
};

const mountRunner = (testFile: string, testNamePattern?: string): void => {
  const runId = createRunId();
  runIdMap.set(testFile, runId);

  let iframe = iframeMap.get(testFile);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '0';
    iframe.style.top = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    iframe.title = `Scheduler runner for ${testFile}`;
    iframe.dataset.testFile = testFile;
    iframe.addEventListener('load', () => {
      postConfig(iframe!, testFile);
    });
    document.body.appendChild(iframe);
    iframeMap.set(testFile, iframe);
  }

  const viewport = resolveViewport(testFile);
  if (viewport) {
    iframe.style.width = `${viewport.width}px`;
    iframe.style.height = `${viewport.height}px`;
  } else {
    iframe.style.width = '100vw';
    iframe.style.height = '100vh';
  }

  iframe.src = createRunnerUrl(
    testFile,
    options?.runnerUrl,
    testNamePattern,
    true,
    runId,
  );
};

const unmountRemovedFiles = (nextFiles: TestFileInfo[]): void => {
  const nextSet = new Set(nextFiles.map((f) => f.testPath));
  for (const [testFile, frame] of iframeMap.entries()) {
    if (!nextSet.has(testFile)) {
      frame.remove();
      iframeMap.delete(testFile);
      fileProjectMap.delete(testFile);
      runIdMap.delete(testFile);
    }
  }
};

const syncFiles = (files: TestFileInfo[]): void => {
  const previous = new Set(fileProjectMap.keys());
  unmountRemovedFiles(files);
  for (const file of files) {
    fileProjectMap.set(file.testPath, file.projectName);
  }
  const added = files.filter((file) => !previous.has(file.testPath));
  for (const file of added) {
    mountRunner(file.testPath);
  }
};

const forwardClientMessage = async (
  message: BrowserClientMessage,
): Promise<void> => {
  if (!rpc) {
    return;
  }

  try {
    switch (message.type) {
      case 'file-start':
        await rpc.onTestFileStart(message.payload as TestFileStartPayload);
        break;
      case 'case-result':
        await rpc.onTestCaseResult(message.payload as BrowserClientTestResult);
        break;
      case 'file-complete':
        await rpc.onTestFileComplete(
          message.payload as BrowserClientFileResult,
        );
        break;
      case 'log':
        await rpc.onLog(message.payload as LogPayload);
        break;
      case 'fatal':
        await rpc.onFatal(message.payload as FatalPayload);
        break;
      default:
        break;
    }
  } catch (error) {
    debugLog('failed to forward client message', error);
  }
};

const scheduleReconnect = () => {
  const delay =
    RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt++;
  debugLog(`reconnecting in ${delay}ms`);
  reconnectTimeoutId = setTimeout(() => {
    void connect().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      debugLog('reconnect attempt failed', message);
      scheduleReconnect();
    });
  }, delay);
};

const connect = async (): Promise<void> => {
  if (!options?.wsPort) {
    throw new Error('Scheduler requires wsPort in browser options.');
  }

  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }

  const ws = new WebSocket(createWebSocketUrl(options.wsPort));

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Scheduler websocket timeout after ${rpcTimeout}ms`));
    }, rpcTimeout);

    ws.addEventListener('open', () => {
      clearTimeout(timeoutId);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timeoutId);
      reject(new Error('Scheduler websocket failed to connect.'));
    });
  });

  reconnectAttempt = 0;

  const methods: ContainerRPC = {
    onTestFileUpdate(testFiles) {
      debugLog('onTestFileUpdate', testFiles.length);
      syncFiles(testFiles);
    },
    reloadTestFile(testFile, testNamePattern) {
      debugLog('reloadTestFile', testFile, testNamePattern);
      mountRunner(testFile, testNamePattern);
    },
  };

  rpc = createBirpc<HostRPC, ContainerRPC>(methods, {
    timeout: rpcTimeout,
    post(data) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
    on(fn) {
      ws.addEventListener('message', (event) => {
        try {
          fn(JSON.parse(String(event.data)));
        } catch {
          // ignore invalid payloads
        }
      });
    },
  });

  ws.addEventListener('close', () => {
    debugLog('websocket closed');
    rpc = null;
    scheduleReconnect();
  });

  const files = await rpc.getTestFiles();
  syncFiles(files);
};

window.addEventListener('message', (event: MessageEvent) => {
  const message = readDispatchMessage(event);
  if (!message) {
    return;
  }
  if (message.type === 'snapshot-rpc-request') {
    void forwardSnapshotRpcRequest(
      rpc,
      message.payload as SnapshotRpcRequest,
      event.source,
    );
    return;
  }
  if (message.type === 'plugin') {
    void forwardPluginRpcRequest(
      rpc,
      message as BrowserPluginRequestMessage,
      event.source,
    );
    return;
  }
  void forwardClientMessage(message);
});

void connect().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Scheduler] Failed to initialize:', message);
  scheduleReconnect();
});

import { type BirpcReturn, createBirpc } from 'birpc';
import { useEffect, useRef, useState } from 'react';
import type {
  BrowserClientFileResult,
  BrowserClientTestResult,
  TestFileInfo,
} from '../types';

// ============================================================================
// RPC Types
// ============================================================================

/** Payload for test file start event */
export type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

/** Payload for log event */
export type LogPayload = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  content: string;
  testPath: string;
  type: 'stdout' | 'stderr';
  trace?: string;
};

/** Payload for fatal error event */
export type FatalPayload = {
  message: string;
  stack?: string;
};

export type HostRPC = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  // Test result callbacks from container
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: BrowserClientTestResult) => Promise<void>;
  onTestFileComplete: (payload: BrowserClientFileResult) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => void;
  reloadTestFile: (testFile: string, testNamePattern?: string) => void;
};

export type RpcState = {
  rpc: BirpcReturn<HostRPC, ContainerRPC> | null;
  loading: boolean;
  connected: boolean;
};

// ============================================================================
// useRpc Hook - WebSocket connection with reconnect logic
// ============================================================================

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // Exponential backoff, max 30s

export const useRpc = (
  setTestFiles: (files: TestFileInfo[]) => void,
  wsPort: number | undefined,
  onReloadTestFile?: (testFile: string, testNamePattern?: string) => void,
): RpcState => {
  const [rpc, setRpc] = useState<BirpcReturn<HostRPC, ContainerRPC> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  // Use refs to avoid triggering reconnect on callback changes
  const setTestFilesRef = useRef<(files: TestFileInfo[]) => void>(setTestFiles);
  const onReloadTestFileRef = useRef(onReloadTestFile);
  // Track the current active WebSocket to handle StrictMode double-mount
  const activeWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setTestFilesRef.current = setTestFiles;
  }, [setTestFiles]);

  useEffect(() => {
    onReloadTestFileRef.current = onReloadTestFile;
  }, [onReloadTestFile]);

  useEffect(() => {
    if (!wsPort) {
      setLoading(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}`;
      ws = new WebSocket(wsUrl);
      activeWsRef.current = ws;

      const methods: ContainerRPC = {
        onTestFileUpdate(files: TestFileInfo[]) {
          console.log('[Container RPC] onTestFileUpdate called:', files);
          setTestFilesRef.current(files);
        },
        reloadTestFile(testFile: string, testNamePattern?: string) {
          console.log(
            '[Container RPC] reloadTestFile called:',
            testFile,
            testNamePattern,
          );
          onReloadTestFileRef.current?.(testFile, testNamePattern);
        },
      };

      ws.onopen = () => {
        if (!isMounted || !ws) return;

        console.log('[Container] WebSocket connected');
        reconnectAttempt = 0; // Reset reconnect counter on successful connection
        setConnected(true);

        const birpc = createBirpc<HostRPC, ContainerRPC>(methods, {
          post: (data) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(data));
            }
          },
          on: (fn) => {
            if (!ws) return;
            ws.onmessage = (event) => {
              try {
                const data = JSON.parse(event.data);
                fn(data);
              } catch {
                // ignore invalid messages
              }
            };
          },
        });
        setRpc(birpc);

        // Fetch test files once connected
        birpc
          .getTestFiles()
          .then((files) => {
            if (isMounted) {
              setTestFilesRef.current(files);
              setLoading(false);
            }
          })
          .catch(() => {
            if (isMounted) {
              setLoading(false);
            }
          });
      };

      ws.onclose = () => {
        // Only handle close if this is still the active connection
        // This prevents race conditions in StrictMode where the old connection's
        // close event fires after a new connection has been established
        if (activeWsRef.current !== ws) {
          return;
        }

        if (!isMounted) return;

        console.log('[Container] WebSocket disconnected');
        setRpc(null);
        setConnected(false);

        // Schedule reconnect with exponential backoff
        const delay =
          RECONNECT_DELAYS[
            Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)
          ];
        console.log(
          `[Container] Reconnecting in ${delay}ms (attempt ${reconnectAttempt + 1})`,
        );
        reconnectAttempt++;

        reconnectTimeoutId = setTimeout(() => {
          if (isMounted) {
            connect();
          }
        }, delay);
      };

      ws.onerror = () => {
        if (!isMounted) return;
        console.log('[Container] WebSocket error');
        // onclose will be called after onerror, which handles reconnect
      };
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [wsPort]); // Only depend on wsPort

  return { rpc, loading, connected };
};

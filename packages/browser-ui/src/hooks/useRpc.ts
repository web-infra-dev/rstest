import { type BirpcReturn, createBirpc } from 'birpc';
import { useEffect, useRef, useState } from 'react';
import { createWebSocketUrl, RECONNECT_DELAYS } from '../core/runtime';
import type { ContainerRPC, HostRPC, TestFileInfo } from '../types';
import { logger } from '../utils/logger';

export type RpcState = {
  rpc: BirpcReturn<HostRPC, ContainerRPC> | null;
  loading: boolean;
  connected: boolean;
};

// ============================================================================
// useRpc Hook - WebSocket connection with reconnect logic
// ============================================================================

export const useRpc = (
  setTestFiles: (files: TestFileInfo[]) => void,
  wsPort: number | undefined,
  onReloadTestFile?: (
    testFile: string,
    testNamePattern?: string,
  ) => Promise<void>,
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

      ws = new WebSocket(createWebSocketUrl(wsPort));
      activeWsRef.current = ws;

      const methods: ContainerRPC = {
        onTestFileUpdate(files: TestFileInfo[]) {
          logger.debug('[Container RPC] onTestFileUpdate called:', files);
          setTestFilesRef.current(files);
        },
        async reloadTestFile(testFile: string, testNamePattern?: string) {
          logger.debug(
            '[Container RPC] reloadTestFile called:',
            testFile,
            testNamePattern,
          );
          await onReloadTestFileRef.current?.(testFile, testNamePattern);
        },
      };

      ws.onopen = () => {
        if (!isMounted || !ws) return;

        logger.debug('[Container] WebSocket connected');
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

        logger.debug('[Container] WebSocket disconnected');
        setRpc(null);
        setConnected(false);

        // Schedule reconnect with exponential backoff
        const delay =
          RECONNECT_DELAYS[
            Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)
          ];
        logger.debug(
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
        logger.debug('[Container] WebSocket error');
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

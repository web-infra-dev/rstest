import { type BirpcReturn, createBirpc } from 'birpc';
import { useEffect, useRef, useState } from 'react';

// ============================================================================
// RPC Types
// ============================================================================

export type HostRPC = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: string[]) => void;
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
  setTestFiles: (files: string[]) => void,
  wsPort: number | undefined,
  onReloadTestFile?: (testFile: string, testNamePattern?: string) => void,
): RpcState => {
  const [rpc, setRpc] = useState<BirpcReturn<HostRPC, ContainerRPC> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  // Use refs to avoid triggering reconnect on callback changes
  const setTestFilesRef = useRef(setTestFiles);
  const onReloadTestFileRef = useRef(onReloadTestFile);

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

      const methods: ContainerRPC = {
        onTestFileUpdate(files: string[]) {
          setTestFilesRef.current(files);
        },
        reloadTestFile(testFile: string, testNamePattern?: string) {
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

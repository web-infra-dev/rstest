import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createBirpc } from 'birpc';
import type { BrowserClientMessage, BrowserHostConfig } from './types';
import './index.css';

type HostRPC = {
  rerunTest: (testFile: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

type ContainerRPC = {
  onTestFileUpdate: (testFiles: string[]) => void;
};

type ContainerWindow = Window &
  typeof globalThis & {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (cb: (data: unknown) => void) => void;
    __rstest_dispatch__?: (payload: unknown) => void;
  };

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

const useRpc = (setTestFiles: (files: string[]) => void) => {
  const rpc = useMemo(() => {
    const methods: ContainerRPC = {
      onTestFileUpdate(files: string[]) {
        setTestFiles(files);
      },
    };

    return createBirpc<HostRPC, ContainerRPC>(methods, {
      post: (data) => {
        (window as ContainerWindow).__rstest_container_dispatch__?.(data);
      },
      on: (fn) => {
        (window as ContainerWindow).__rstest_container_on__ = fn;
      },
    });
  }, [setTestFiles]);

  useEffect(() => {
    rpc.getTestFiles().then((files) => setTestFiles(files));
  }, [rpc, setTestFiles]);

  return rpc;
};

const getDisplayName = (testFile: string) => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const iframeUrlFor = (testFile: string, runnerBase?: string) => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  return url.toString();
};

const App: React.FC = () => {
  const options = (window as ContainerWindow).__RSTEST_BROWSER_OPTIONS__;
  const [testFiles, setTestFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const rpc = useRpc(setTestFiles);

  useEffect(() => {
    setStatusMap((prev) => {
      const next: Record<string, TestStatus> = {};
      for (const file of testFiles) {
        next[file] = prev[file] ?? 'idle';
      }
      return next;
    });
  }, [testFiles]);

  useEffect(() => {
    if (!active && testFiles.length > 0) {
      setActive(testFiles[0]!);
    }
  }, [active, testFiles]);

  const handleSelect = (file: string) => {
    setActive(file);
  };

  const handleRerun = async () => {
    if (active) {
      await rpc.rerunTest(active);
    }
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === '__rstest_dispatch__') {
        const message = event.data.payload as BrowserClientMessage | undefined;
        if (message?.type === 'file-start') {
          const testPath = message.payload.testPath;
          setStatusMap((prev) => ({ ...prev, [testPath]: 'running' }));
        } else if (message?.type === 'file-complete') {
          const testPath = message.payload.testPath as string;
          const passed = message.payload.status === 'pass';
          setStatusMap((prev) => ({
            ...prev,
            [testPath]: passed ? 'pass' : 'fail',
          }));
        } else if (message?.type === 'fatal') {
          if (active) {
            setStatusMap((prev) => ({ ...prev, [active]: 'fail' }));
          }
        }
        (window as ContainerWindow).__rstest_dispatch__?.(event.data.payload);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [active]);

  if (!options) {
    return <div>Missing browser options</div>;
  }

  return (
    <div className="container">
      <div className="sidebar">
        <div className="header">
          <h2>Test Files</h2>
          <button id="rerun-btn" className="rerun-btn" onClick={handleRerun}>
            Re-run
          </button>
        </div>
        <div id="test-file-list" className="test-file-list">
          {testFiles.map((file) => (
            <div
              key={file}
              className={`test-file-tab ${file === active ? 'active' : ''}`}
              data-test-file={file}
              onClick={() => handleSelect(file)}
              title={file}
            >
              <span className="test-file-tab__status">
                {statusMap[file] === 'pass'
                  ? '✅'
                  : statusMap[file] === 'fail'
                    ? '❌'
                    : statusMap[file] === 'running'
                      ? '…'
                      : ''}
              </span>
              <span className="test-file-tab__name">{getDisplayName(file)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="main">
        <div id="iframe-container" className="iframe-container">
          {testFiles.map((file) => (
            <iframe
              key={file}
              className="test-runner-iframe"
              data-test-file={file}
              src={iframeUrlFor(file, options.runnerUrl)}
              style={{ display: file === active ? 'block' : 'none' }}
              onLoad={(event) => {
                const frame = event.currentTarget;
                if (frame.contentWindow) {
                  frame.contentWindow.postMessage(
                    {
                      type: 'RSTEST_CONFIG',
                      payload: {
                        ...options,
                        testFile: file,
                      },
                    },
                    '*',
                  );
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const mount = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    return;
  }
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

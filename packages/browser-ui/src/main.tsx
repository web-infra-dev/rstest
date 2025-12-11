import { App as AntdApp, theme as antdTheme, ConfigProvider } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { EmptyPreviewOverlay } from './components/EmptyPreviewOverlay';
import { PreviewHeader } from './components/PreviewHeader';
import { ResizablePanel, ResizablePanelGroup } from './components/Resizable';
import { SidebarHeader } from './components/SidebarHeader';
import { StatsBar } from './components/StatsBar';
import { TestFilesHeader } from './components/TestFilesHeader';
import { TestFilesTree } from './components/TestFilesTree';
import { useRpc } from './hooks/useRpc';
import type {
  BrowserClientFileResult,
  BrowserClientMessage,
  BrowserClientTestResult,
  BrowserHostConfig,
} from './types';
import {
  type CaseInfo,
  type CaseStatus,
  type ContainerWindow,
  STATUS_META,
  type TestStatus,
} from './utils/constants';
import './index.css';

// ============================================================================
// Utility Functions
// ============================================================================

const getDisplayName = (testFile: string): string => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const iframeUrlFor = (
  testFile: string,
  runnerBase?: string,
  testNamePattern?: string,
): string => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  if (testNamePattern) {
    url.searchParams.set('testNamePattern', testNamePattern);
  }
  return url.toString();
};

// ============================================================================
// BrowserRunner Component
// ============================================================================

const BrowserRunner: React.FC<{
  options: BrowserHostConfig;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
}> = ({ options, theme, setTheme }) => {
  const { token } = antdTheme.useToken();
  const [testFiles, setTestFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const [caseMap, setCaseMap] = useState<
    Record<string, Record<string, CaseInfo>>
  >({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);

  const handleReloadTestFile = useCallback(
    (testFile: string, testNamePattern?: string) => {
      console.log(
        '[Container] handleReloadTestFile called:',
        testFile,
        testNamePattern,
      );
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-test-file="${testFile}"]`,
      );
      console.log('[Container] Found iframe:', iframe);
      if (iframe) {
        setStatusMap((prev) => ({ ...prev, [testFile]: 'running' }));
        setCaseMap((prev) => {
          const prevFile = prev[testFile] ?? {};
          const updatedCases: Record<string, CaseInfo> = {};
          for (const [key, caseInfo] of Object.entries(prevFile)) {
            updatedCases[key] = { ...caseInfo, status: 'running' };
          }
          return { ...prev, [testFile]: updatedCases };
        });
        const newSrc = iframeUrlFor(
          testFile,
          options.runnerUrl,
          testNamePattern,
        );
        console.log('[Container] Setting iframe.src to:', newSrc);
        iframe.src = newSrc;
      }
    },
    [options.runnerUrl],
  );

  const { rpc, loading, connected } = useRpc(
    setTestFiles,
    options?.wsPort,
    handleReloadTestFile,
  );

  // Consolidated effect for handling testFiles changes
  // Handles statusMap, caseMap, openFiles initialization and cleanup
  useEffect(() => {
    // Update statusMap: preserve existing status, set new files to 'idle'
    setStatusMap((prev) => {
      const next: Record<string, TestStatus> = {};
      for (const file of testFiles) {
        next[file] = prev[file] ?? 'idle';
      }
      return next;
    });

    // Update caseMap: preserve existing cases, initialize new files with empty object
    setCaseMap((prev) => {
      const next: Record<string, Record<string, CaseInfo>> = {};
      for (const file of testFiles) {
        next[file] = prev[file] ?? {};
      }
      return next;
    });

    // Clean up openFiles: remove files that no longer exist
    setOpenFiles((prev) => prev.filter((file) => testFiles.includes(file)));

    // Auto-select first file if none selected
    setActive((prev) => {
      if (!prev && testFiles.length > 0) {
        return testFiles[0]!;
      }
      // If current active file was removed, select first file
      if (prev && !testFiles.includes(prev) && testFiles.length > 0) {
        return testFiles[0]!;
      }
      return prev;
    });
  }, [testFiles]);

  const mapCaseStatus = useCallback(
    (status?: BrowserClientTestResult['status']): CaseStatus => {
      if (status === 'pass') return 'pass';
      if (status === 'fail') return 'fail';
      if (status === 'skip' || status === 'todo') return 'skip';
      return 'running';
    },
    [],
  );

  const handleSelect = useCallback((file: string) => {
    setActive(file);
  }, []);

  const upsertCase = useCallback(
    (filePath: string, payload: BrowserClientTestResult) => {
      const parentNames = (payload.parentNames ?? []).filter(Boolean);
      const fullName =
        [...parentNames, payload.name].join('  ') || payload.name;
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};
        return {
          ...prev,
          [filePath]: {
            ...prevFile,
            [payload.testId]: {
              id: payload.testId,
              name: payload.name,
              parentNames,
              fullName,
              status: mapCaseStatus(payload.status),
              filePath: payload.testPath || filePath,
              location: payload.location,
            },
          },
        };
      });
    },
    [mapCaseStatus],
  );

  const handleRerunFile = useCallback(
    (file: string) => {
      if (rpc && connected) {
        void rpc.rerunTest(file);
      }
    },
    [rpc, connected],
  );

  const handleRerunTestCase = useCallback(
    (file: string, testName: string) => {
      if (rpc && connected) {
        void rpc.rerunTest(file, testName);
      }
    },
    [rpc, connected],
  );

  const handleRerun = useCallback(() => {
    if (active && rpc && connected) {
      void rpc.rerunTest(active);
    }
  }, [active, rpc, connected]);

  // Handle messages from test runner iframes
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === '__rstest_dispatch__') {
        const message = event.data.payload as BrowserClientMessage | undefined;
        if (message?.type === 'file-start') {
          const payload = message.payload as { testPath?: string };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            setStatusMap((prev) => ({ ...prev, [testPath]: 'running' }));
            setCaseMap((prev) => {
              const prevFile = prev[testPath] ?? {};
              const updatedCases: Record<string, CaseInfo> = {};
              for (const [key, caseInfo] of Object.entries(prevFile)) {
                updatedCases[key] = { ...caseInfo, status: 'running' };
              }
              return { ...prev, [testPath]: updatedCases };
            });
          }
        } else if (message?.type === 'case-result') {
          const payload = message.payload as BrowserClientTestResult;
          if (payload?.testPath) {
            upsertCase(payload.testPath, payload);
          }
        } else if (message?.type === 'file-complete') {
          const payload = message.payload as BrowserClientFileResult;
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            const passed =
              payload.status === 'pass' || payload.status === 'skip';
            setStatusMap((prev) => ({
              ...prev,
              [testPath]: passed ? 'pass' : 'fail',
            }));
            // Replace the caseMap for this file with only the cases that exist in the results
            // This ensures deleted test cases are removed from the UI
            setCaseMap((prev) => {
              const newCases: Record<string, CaseInfo> = {};
              for (const result of payload.results ?? []) {
                if (result?.testId) {
                  const parentNames = (result.parentNames ?? []).filter(
                    Boolean,
                  );
                  const fullName =
                    [...parentNames, result.name].join('  ') || result.name;
                  newCases[result.testId] = {
                    id: result.testId,
                    name: result.name,
                    parentNames,
                    fullName,
                    status: mapCaseStatus(result.status),
                    filePath: result.testPath || testPath,
                    location: result.location,
                  };
                }
              }
              return { ...prev, [testPath]: newCases };
            });
          }
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
  }, [active, upsertCase, mapCaseStatus]);

  // Computed values
  const counts = useMemo(
    () => ({
      pass: Object.values(statusMap).filter((s) => s === 'pass').length,
      fail: Object.values(statusMap).filter((s) => s === 'fail').length,
    }),
    [statusMap],
  );

  const completedTotal = counts.pass + counts.fail;
  const successPercent =
    completedTotal === 0 ? 0 : (counts.pass / completedTotal) * 100;
  const progressPercent = completedTotal === 0 ? 0 : 100;
  const isDark = theme === 'dark';
  const themeSwitchLabel = isDark
    ? 'Switch to light theme'
    : 'Switch to dark theme';

  return (
    <div
      className="m-0 h-screen w-full overflow-hidden p-0"
      style={{ background: token.colorBgContainer }}
    >
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full w-full"
        autoSaveId="rstest-split"
      >
        <ResizablePanel defaultSize={32} minSize={20} maxSize={50}>
          <div
            className="flex h-full flex-col overflow-hidden"
            style={{
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            <SidebarHeader
              themeSwitchLabel={themeSwitchLabel}
              isDark={isDark}
              onThemeToggle={(checked: boolean) =>
                setTheme(checked ? 'dark' : 'light')
              }
              onRerun={connected ? handleRerun : undefined}
              isConnected={connected}
              token={token}
              progressPercent={progressPercent}
              successPercent={successPercent}
            />

            <StatsBar
              passCount={counts.pass}
              failCount={counts.fail}
              borderColor={token.colorBorderSecondary}
              background={token.colorFillQuaternary}
            />

            <TestFilesHeader isConnected={connected} token={token} />

            <div
              className="flex-1 overflow-x-hidden overflow-y-auto"
              style={{ background: token.colorBgContainer }}
            >
              <TestFilesTree
                testFiles={testFiles}
                statusMap={statusMap}
                caseMap={caseMap}
                rootPath={options.rootPath}
                loading={loading}
                connected={connected}
                openFiles={openFiles}
                activeFile={active}
                token={token}
                onExpandChange={setOpenFiles}
                onSelect={handleSelect}
                onRerunFile={handleRerunFile}
                onRerunTestCase={handleRerunTestCase}
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizablePanel defaultSize={68} minSize={40}>
          <div
            className="flex h-full flex-col overflow-hidden"
            style={{ background: token.colorBgLayout }}
          >
            <PreviewHeader
              token={token}
              activeDisplayName={
                active ? getDisplayName(active) : 'Select a test file'
              }
              statusLabel={
                active
                  ? STATUS_META[statusMap[active] ?? 'idle'].label
                  : undefined
              }
              statusColor={
                active
                  ? STATUS_META[statusMap[active] ?? 'idle'].color
                  : undefined
              }
            />

            <div
              className="relative min-h-0 flex-1"
              style={{ background: token.colorBgContainer }}
            >
              {!active && (
                <EmptyPreviewOverlay message="Select a test file on the left to view its run output" />
              )}
              {testFiles.map((file) => (
                <iframe
                  key={file}
                  data-test-file={file}
                  title={`Test runner for ${getDisplayName(file)}`}
                  src={iframeUrlFor(file, options.runnerUrl)}
                  className="h-full w-full border-0"
                  style={{
                    display: file === active ? 'block' : 'none',
                    background: token.colorBgContainer,
                  }}
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
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

// ============================================================================
// App Component
// ============================================================================

const App: React.FC = () => {
  const options = (window as ContainerWindow).__RSTEST_BROWSER_OPTIONS__;
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('rstest-theme');
      if (stored === 'light' || stored === 'dark') {
        setTheme(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      window.localStorage.setItem('rstest-theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  if (!options) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white">
        Missing browser options
      </div>
    );
  }

  const isDark = theme === 'dark';

  return (
    <ConfigProvider
      componentSize="small"
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          fontFamily:
            '"Space Grotesk","Inter",system-ui,-apple-system,"Segoe UI",sans-serif',
          colorInfo: isDark ? '#ffffff' : '#0f0f0f',
        },
      }}
    >
      <AntdApp>
        <BrowserRunner options={options} theme={theme} setTheme={setTheme} />
      </AntdApp>
    </ConfigProvider>
  );
};

// ============================================================================
// Mount
// ============================================================================

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

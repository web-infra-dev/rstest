import {
  App as AntdApp,
  theme as antdTheme,
  ConfigProvider,
  Tree,
  Typography,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { type BirpcReturn, createBirpc } from 'birpc';
import { ChevronDown } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { EmptyPreviewOverlay } from './components/browser/EmptyPreviewOverlay';
import { PreviewHeader } from './components/browser/PreviewHeader';
import { SidebarHeader } from './components/browser/SidebarHeader';
import { StatsBar } from './components/browser/StatsBar';
import { TestCaseTitle } from './components/browser/TestCaseTitle';
import { TestFilesHeader } from './components/browser/TestFilesHeader';
import { TestFileTitle } from './components/browser/TestFileTitle';
import { ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import {
  CASE_STATUS_META,
  type CaseInfo,
  type CaseStatus,
  type ContainerWindow,
  STATUS_META,
  type TestStatus,
} from './constants';
import type {
  BrowserClientFileResult,
  BrowserClientMessage,
  BrowserClientTestResult,
  BrowserHostConfig,
} from './types';
import './index.css';

const { Text } = Typography;

type HostRPC = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<string[]>;
};

type ContainerRPC = {
  onTestFileUpdate: (testFiles: string[]) => void;
  reloadTestFile: (testFile: string, testNamePattern?: string) => void;
};

const toRelativePath = (file: string, rootPath?: string) => {
  if (!rootPath) return file;
  const normalizedRoot = rootPath.endsWith('/')
    ? rootPath.slice(0, -1)
    : rootPath;
  if (file.startsWith(normalizedRoot)) {
    const sliced = file.slice(normalizedRoot.length);
    return sliced.startsWith('/') ? sliced.slice(1) : sliced;
  }
  return file;
};

const openInEditor = (file: string) => {
  const payload = { type: 'open-in-editor', payload: { file } };
  (window as ContainerWindow).__rstest_dispatch__?.(payload as unknown);
  window.parent?.postMessage(payload, '*');
  fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`).catch(() => {});
};

const useRpc = (
  setTestFiles: (files: string[]) => void,
  initialTestFiles: string[],
  wsPort: number | undefined,
  onReloadTestFile?: (testFile: string, testNamePattern?: string) => void,
): BirpcReturn<HostRPC, ContainerRPC> | null => {
  const [rpc, setRpc] = useState<BirpcReturn<HostRPC, ContainerRPC> | null>(
    null,
  );

  useEffect(() => {
    if (!wsPort) {
      // No WebSocket port, fall back to static mode
      if (initialTestFiles.length > 0) {
        setTestFiles(initialTestFiles);
      }
      return;
    }

    // Connect to WebSocket server
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}`;
    const ws = new WebSocket(wsUrl);

    const methods: ContainerRPC = {
      onTestFileUpdate(files: string[]) {
        setTestFiles(files);
      },
      reloadTestFile(testFile: string, testNamePattern?: string) {
        onReloadTestFile?.(testFile, testNamePattern);
      },
    };

    ws.onopen = () => {
      console.log('[Container] WebSocket connected');
      const birpc = createBirpc<HostRPC, ContainerRPC>(methods, {
        post: (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
          }
        },
        on: (fn) => {
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
        .then((files) => setTestFiles(files))
        .catch(() => setTestFiles(initialTestFiles));
    };

    ws.onclose = () => {
      console.log('[Container] WebSocket disconnected');
      setRpc(null);
    };

    ws.onerror = () => {
      console.log('[Container] WebSocket error, falling back to static mode');
      setTestFiles(initialTestFiles);
    };

    return () => {
      ws.close();
    };
  }, [initialTestFiles, onReloadTestFile, setTestFiles, wsPort]);

  return rpc;
};

const getDisplayName = (testFile: string) => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const iframeUrlFor = (
  testFile: string,
  runnerBase?: string,
  testNamePattern?: string,
) => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  if (testNamePattern) {
    url.searchParams.set('testNamePattern', testNamePattern);
  }
  return url.toString();
};

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
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-test-file="${testFile}"]`,
      );
      if (iframe) {
        // Set file status to running
        setStatusMap((prev) => ({ ...prev, [testFile]: 'running' }));
        // Set all cases in this file to running status, preserving existing data
        setCaseMap((prev) => {
          const prevFile = prev[testFile] ?? {};
          const updatedCases: Record<string, CaseInfo> = {};
          for (const [key, caseInfo] of Object.entries(prevFile)) {
            updatedCases[key] = { ...caseInfo, status: 'running' };
          }
          return { ...prev, [testFile]: updatedCases };
        });
        // Reload iframe with new URL
        iframe.src = iframeUrlFor(testFile, options.runnerUrl, testNamePattern);
      }
    },
    [options.runnerUrl],
  );

  const rpc = useRpc(
    setTestFiles,
    options?.testFiles || [],
    options?.wsPort,
    handleReloadTestFile,
  );

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
    setCaseMap((prev) => {
      const next = { ...prev };
      for (const file of testFiles) {
        next[file] = next[file] ?? {};
      }
      return next;
    });
  }, [testFiles]);

  useEffect(() => {
    setOpenFiles((prev) => prev.filter((file) => testFiles.includes(file)));
  }, [testFiles]);

  useEffect(() => {
    if (!active && testFiles.length > 0) {
      setActive(testFiles[0]!);
    }
  }, [active, testFiles]);

  useEffect(() => {
    if (active) {
      setOpenFiles((prev) =>
        prev.includes(active) ? prev : [...prev, active],
      );
    }
  }, [active]);

  const mapCaseStatus = useCallback(
    (status?: BrowserClientTestResult['status']): CaseStatus => {
      if (status === 'pass') return 'pass';
      if (status === 'fail') return 'fail';
      if (status === 'skip' || status === 'todo') return 'skip';
      return 'running';
    },
    [],
  );

  const handleSelect = (file: string) => {
    setActive(file);
  };

  const upsertCase = useCallback(
    (
      filePath: string,
      payload: BrowserClientTestResult,
      statusOverride?: CaseStatus,
    ) => {
      const labelParts = [...(payload.parentNames ?? []), payload.name].filter(
        Boolean,
      );
      const label = labelParts.join(' > ') || payload.name;
      // fullName uses empty delimiter to match task.ts getTaskNameWithPrefix(test, '')
      const fullName = labelParts.join('  ') || payload.name;
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};
        return {
          ...prev,
          [filePath]: {
            ...prevFile,
            [payload.testId]: {
              id: payload.testId,
              label,
              fullName,
              status: statusOverride ?? mapCaseStatus(payload.status),
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
    async (file: string) => {
      if (rpc) {
        await rpc.rerunTest(file);
      }
    },
    [rpc],
  );

  const handleRerunTestCase = useCallback(
    async (file: string, testName: string) => {
      if (rpc) {
        await rpc.rerunTest(file, testName);
      }
    },
    [rpc],
  );

  const handleRerun = useCallback(async () => {
    if (active && rpc) {
      await rpc.rerunTest(active);
    }
  }, [active, rpc]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === '__rstest_dispatch__') {
        const message = event.data.payload as BrowserClientMessage | undefined;
        if (message?.type === 'file-start') {
          const payload = message.payload as { testPath?: string };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            setStatusMap((prev) => ({ ...prev, [testPath]: 'running' }));
            // Set all cases to running status instead of clearing them
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
            (payload.results ?? []).forEach((result) => {
              if (result?.testPath) {
                upsertCase(result.testPath, result);
              }
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
  }, [active, upsertCase]);

  const counts = {
    pass: Object.values(statusMap).filter((s) => s === 'pass').length,
    fail: Object.values(statusMap).filter((s) => s === 'fail').length,
  };
  const completedTotal = counts.pass + counts.fail;
  const successPercent =
    completedTotal === 0 ? 0 : (counts.pass / completedTotal) * 100;
  const progressPercent = completedTotal === 0 ? 0 : 100;
  const isDark = theme === 'dark';
  const themeSwitchLabel = isDark
    ? 'Switch to light theme'
    : 'Switch to dark theme';

  const treeData: DataNode[] = useMemo(
    () =>
      testFiles.map((file) => {
        const status = statusMap[file] ?? 'idle';
        const meta = STATUS_META[status];
        const relativePath = toRelativePath(file, options.rootPath);
        const cases = Object.values(caseMap[file] ?? {});
        const children: DataNode[] =
          cases.length === 0
            ? [
                {
                  key: `${file}::__empty`,
                  title: (
                    <Text type="secondary" className="text-xs">
                      No test cases reported yet
                    </Text>
                  ),
                  isLeaf: true,
                  selectable: false,
                },
              ]
            : cases.map((testCase) => {
                const caseMeta = CASE_STATUS_META[testCase.status];
                return {
                  key: `${file}::${testCase.id}`,
                  title: (
                    <TestCaseTitle
                      icon={caseMeta.icon}
                      iconColor={caseMeta.color}
                      label={testCase.label}
                      onRerun={() => {
                        void handleRerunTestCase(file, testCase.fullName);
                      }}
                      buttonTextColor={token.colorTextSecondary}
                    />
                  ),
                  isLeaf: true,
                  selectable: false,
                };
              });

        return {
          key: file,
          title: (
            <TestFileTitle
              icon={meta.icon}
              iconColor={meta.color}
              relativePath={relativePath}
              onOpen={() => openInEditor(file)}
              onRerun={() => {
                void handleRerunFile(file);
              }}
              textColor={token.colorTextSecondary}
            />
          ),
          children,
        };
      }),
    [
      caseMap,
      handleRerunFile,
      handleRerunTestCase,
      options.rootPath,
      statusMap,
      testFiles,
      token,
    ],
  );

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
              onRerun={handleRerun}
              isConnected={Boolean(rpc)}
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

            <TestFilesHeader isConnected={Boolean(rpc)} token={token} />

            <div
              className="flex-1 overflow-x-hidden overflow-y-auto"
              style={{ background: token.colorBgContainer }}
            >
              {testFiles.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <Text type="secondary">No test files detected</Text>
                </div>
              ) : (
                <Tree
                  blockNode
                  showLine={false}
                  switcherIcon={<ChevronDown size={12} />}
                  showIcon
                  expandAction="click"
                  expandedKeys={openFiles}
                  selectedKeys={active ? [active] : []}
                  onExpand={(keys) =>
                    setOpenFiles(
                      (keys as React.Key[]).filter(
                        (key): key is string => typeof key === 'string',
                      ),
                    )
                  }
                  onSelect={(_keys, info) => {
                    const key = info.node.key;
                    if (typeof key === 'string' && testFiles.includes(key)) {
                      handleSelect(key);
                    }
                  }}
                  treeData={treeData}
                  className="m-1! bg-transparent"
                />
              )}
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

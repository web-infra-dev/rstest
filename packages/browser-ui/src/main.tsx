import { type BirpcReturn, createBirpc } from 'birpc';
import {
  Check,
  ExternalLink,
  File,
  Globe,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  RotateCw,
  Sparkles,
  Sun,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from './components/ui/button';
import { ScrollArea } from './components/ui/scroll-area';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './components/ui/resizable';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip';
import { cn } from './lib/utils';
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

const statusMeta: Record<
  TestStatus,
  {
    label: string;
    accentBg: string;
    accentColor: string;
    icon: React.ReactNode;
  }
> = {
  idle: {
    label: 'Idle',
    accentBg: 'rgba(255,255,255,0.06)',
    accentColor: '#d1d5db',
    icon: <Sparkles size={16} strokeWidth={2.1} />,
  },
  running: {
    label: 'Running',
    accentBg: 'rgba(227,179,65,0.16)',
    accentColor: '#f2c94c',
    icon: <Loader2 size={16} className="animate-spin" strokeWidth={2.1} />,
  },
  pass: {
    label: 'Pass',
    accentBg: 'rgba(74,222,128,0.14)',
    accentColor: '#4ade80',
    icon: <Check size={16} strokeWidth={2.1} />,
  },
  fail: {
    label: 'Fail',
    accentBg: 'rgba(248,113,113,0.16)',
    accentColor: '#f87171',
    icon: <XCircle size={16} strokeWidth={2.1} />,
  },
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
  enabled: boolean,
): BirpcReturn<HostRPC, ContainerRPC> | null => {
  const rpc = useMemo(() => {
    if (!enabled) {
      return null;
    }

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
  }, [enabled, setTestFiles]);

  useEffect(() => {
    if (!rpc) {
      if (initialTestFiles.length > 0) {
        setTestFiles(initialTestFiles);
      }
      return;
    }

    rpc
      .getTestFiles()
      .then((files) => setTestFiles(files))
      .catch(() => setTestFiles(initialTestFiles));
  }, [initialTestFiles, rpc, setTestFiles]);

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
  const canUseRpc = Boolean(
    (window as ContainerWindow).__rstest_container_dispatch__,
  );
  const [testFiles, setTestFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const rpc = useRpc(setTestFiles, options?.testFiles || [], canUseRpc);

  useEffect(() => {
    console.log('[Container] __RSTEST_BROWSER_OPTIONS__', options);
  }, [options]);

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

  const handleRerunFile = async (file: string) => {
    if (rpc) {
      await rpc.rerunTest(file);
    }
  };

  const handleRerun = async () => {
    if (active && rpc) {
      await rpc.rerunTest(active);
    }
  };

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type === '__rstest_dispatch__') {
        const message = event.data.payload as BrowserClientMessage | undefined;
        if (message?.type === 'file-start') {
          const payload = message.payload as { testPath?: string };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            setStatusMap((prev) => ({ ...prev, [testPath]: 'running' }));
          }
        } else if (message?.type === 'file-complete') {
          const payload = message.payload as {
            testPath?: string;
            status?: 'pass' | 'fail' | 'skip';
          };
          const testPath = payload.testPath;
          if (typeof testPath === 'string') {
            const passed = payload.status === 'pass';
            setStatusMap((prev) => ({
              ...prev,
              [testPath]: passed ? 'pass' : 'fail',
            }));
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
  }, [active]);

  if (!options) {
    return (
      <div className="app-shell" style={{ color: 'white' }}>
        Missing browser options
      </div>
    );
  }

  const counts = {
    total: testFiles.length,
    pass: Object.values(statusMap).filter((s) => s === 'pass').length,
    fail: Object.values(statusMap).filter((s) => s === 'fail').length,
  };

  return (
    <TooltipProvider delayDuration={120}>
      <div className="app-shell">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full w-full"
          autoSaveId="rstest-split"
        >
          <ResizablePanel defaultSize={32} minSize={20} maxSize={50}>
            <div className="sidebar">
              <div className="sidebar-top">
                <div className="brand">
                  <img
                    src="https://assets.rspack.rs/rstest/rstest-logo-512x512.png"
                    alt="rstest logo"
                    className="brand-logo"
                  />
                  <div className="brand-text">
                    <span className="brand-title">Browser Tests</span>
                    <span className="brand-subtitle">Live runner</span>
                  </div>
                </div>
                <div className="actions">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        aria-label="Toggle theme"
                      >
                        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>切换主题</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRerun}
                        disabled={!rpc}
                        aria-label="Re-run active file"
                      >
                        <RefreshCw size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>重新运行当前文件</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="sidebar-stats">
                <div className="stat">
                  <File size={14} /> <span>{counts.total} files</span>
                </div>
                <div className="stat">
                  <Check size={14} color="#4ade80" /> <span>{counts.pass} passed</span>
                </div>
                <div className="stat">
                  <XCircle size={14} color="#f87171" /> <span>{counts.fail} failed</span>
                </div>
              </div>

              <div className="sidebar-section">
                <span className="section-title">Test files</span>
                <div className="live">
                  {canUseRpc ? (
                    <>
                      <span className="live-dot" />
                      Live
                    </>
                  ) : (
                    'Static'
                  )}
                </div>
              </div>

              <ScrollArea className="sidebar-list">
                {testFiles.length === 0 ? (
                  <div className="empty">No test files detected</div>
                ) : (
                  <div className="file-list">
                    {testFiles.map((file) => {
                      const status = statusMap[file] ?? 'idle';
                      const meta = statusMeta[status];
                      const relativePath = toRelativePath(file, options.rootPath);
                      return (
                        <button
                          key={file}
                          type="button"
                          className={cn(
                            'file-row',
                            active === file && 'file-row-active',
                          )}
                          onClick={() => handleSelect(file)}
                          aria-pressed={active === file}
                        >
                          <div
                            className="file-status"
                            style={{
                              background: meta.accentBg,
                              color: meta.accentColor,
                            }}
                            aria-hidden="true"
                          >
                            {meta.icon}
                          </div>
                          <div className="file-content">
                            <div className="file-title-row">
                              <span className="file-name">{getDisplayName(file)}</span>
                              <span
                                className="file-status-label"
                                style={{ color: meta.accentColor }}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <div className="file-path-row">
                              <button
                                type="button"
                                className="file-path-link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openInEditor(file);
                                }}
                                title={relativePath}
                              >
                                <span className="truncate">{relativePath}</span>
                              </button>
                              <ExternalLink size={12} className="file-path-icon" />
                            </div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="file-rerun"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRerunFile(file);
                                }}
                                aria-label={`Rerun ${getDisplayName(file)}`}
                              >
                                <RotateCw size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>重新运行该文件</TooltipContent>
                          </Tooltip>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle className="divider" />

          <ResizablePanel defaultSize={68} minSize={40}>
            <div className="main-pane">
              <div className="main-header">
                <div className="main-title">
                  <div className="main-icon">
                    <Play size={16} strokeWidth={2.2} />
                  </div>
                  <div className="main-text">
                    <span className="main-eyebrow">Preview</span>
                    <span className="main-name">
                      {active ? getDisplayName(active) : 'Select a test file'}
                    </span>
                  </div>
                </div>
                {active && (
                  <span
                    className="main-status"
                    style={{ color: statusMeta[statusMap[active] ?? 'idle'].accentColor }}
                  >
                    {statusMeta[statusMap[active] ?? 'idle'].label}
                  </span>
                )}
              </div>
              <div className="main-body">
                <div className="iframe-shell">
                  {!active && (
                    <div className="placeholder">
                      <p className="placeholder-text">请选择左侧的测试文件以查看运行画面</p>
                    </div>
                  )}
                  <div className="iframe-stack">
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
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
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

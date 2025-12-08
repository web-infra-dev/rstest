import { type BirpcReturn, createBirpc } from 'birpc';
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  Minus,
  Moon,
  Play,
  RefreshCw,
  RotateCw,
  Sparkles,
  Sun,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Button } from './components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './components/ui/accordion';
import { Progress } from './components/ui/progress';
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
import type {
  BrowserClientFileResult,
  BrowserClientMessage,
  BrowserClientTestResult,
  BrowserHostConfig,
} from './types';
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
    icon: <CheckCircle2 size={16} strokeWidth={2.1} />,
  },
  fail: {
    label: 'Fail',
    accentBg: 'rgba(248,113,113,0.16)',
    accentColor: '#f87171',
    icon: <XCircle size={16} strokeWidth={2.1} />,
  },
};

type CaseStatus = TestStatus | 'skip';

type CaseInfo = {
  id: string;
  label: string;
  status: CaseStatus;
  filePath: string;
  location?: {
    line: number;
    column?: number;
    file?: string;
  };
};

const caseStatusMeta: Record<
  CaseStatus,
  {
    label: string;
    accentBg: string;
    accentColor: string;
    icon: React.ReactNode;
  }
> = {
  idle: statusMeta.idle,
  running: statusMeta.running,
  pass: statusMeta.pass,
  fail: statusMeta.fail,
  skip: {
    label: 'Skip',
    accentBg: 'rgba(148,163,184,0.14)',
    accentColor: '#9ca3af',
    icon: <Minus size={16} strokeWidth={2.1} />,
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

const formatOpenTarget = (
  file: string,
  location?: { line: number; column?: number; file?: string },
) => {
  if (!location?.line) return file;
  const base = location.file || file;
  const suffix = location.column ? `${location.line}:${location.column}` : `${location.line}`;
  return `${base}:${suffix}`;
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
  const [caseMap, setCaseMap] = useState<Record<string, Record<string, CaseInfo>>>(
    {},
  );
  const [openFiles, setOpenFiles] = useState<string[]>([]);
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
      const labelParts = [...(payload.parentNames ?? []), payload.name].filter(Boolean);
      const label = labelParts.join(' / ') || payload.name;
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};
        return {
          ...prev,
          [filePath]: {
            ...prevFile,
          [payload.testId]: {
            id: payload.testId,
            label,
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
            setCaseMap((prev) => ({ ...prev, [testPath]: {} }));
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
            const passed = payload.status === 'pass' || payload.status === 'skip';
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

  if (!options) {
    return (
      <div className="app-shell" style={{ color: 'white' }}>
        Missing browser options
      </div>
    );
  }

  const counts = {
    pass: Object.values(statusMap).filter((s) => s === 'pass').length,
    fail: Object.values(statusMap).filter((s) => s === 'fail').length,
  };
  const completedTotal = counts.pass + counts.fail;

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
                    <span className="brand-subtitle" aria-hidden="true" />
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
                    <TooltipContent>Toggle theme</TooltipContent>
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
                    <TooltipContent>Re-run active file</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div
                className="sidebar-stats"
              >
                <Progress
                  className="sidebar-progress-bar"
                  value={completedTotal === 0 ? 0 : counts.pass}
                  max={completedTotal}
                />
                <div className="stat">
                  <CheckCircle2 size={14} color="#4ade80" />{' '}
                  <span>{counts.pass} passed</span>
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
                  <Accordion
                    type="multiple"
                    className="file-list"
                    value={openFiles}
                    onValueChange={(value) =>
                      setOpenFiles(
                        Array.isArray(value)
                          ? value
                          : value
                            ? [value]
                            : [],
                      )
                    }
                  >
                    {testFiles.map((file) => {
                      const status = statusMap[file] ?? 'idle';
                      const meta = statusMeta[status];
                      const relativePath = toRelativePath(file, options.rootPath);
                      const cases = Object.values(caseMap[file] ?? {});
                      return (
                        <AccordionItem value={file} key={file}>
                          <div
                            className={cn(
                              'file-row',
                              active === file && 'file-row-active',
                            )}
                          >
                            <AccordionTrigger asChild value={file}>
                              <div
                                className="file-row-header"
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSelect(file)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    handleSelect(file);
                                  }
                                }}
                              >
                                <ChevronRight
                                  size={14}
                                  className="file-chevron"
                                  aria-hidden="true"
                                />
                              <div
                                className="file-status"
                                style={{
                                    background: 'transparent',
                                    color: meta.accentColor,
                                }}
                                aria-hidden="true"
                              >
                                {meta.icon}
                              </div>
                                <div className="file-content">
                                  <div className="file-title-row">
                                    <span className="file-name">{getDisplayName(file)}</span>
                                  </div>
                                  <div className="file-path-row">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                    className="file-path-link"
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openInEditor(file);
                                    }}
                                    title={relativePath}
                                  >
                                    <span className="truncate">{relativePath}</span>
                                  </Button>
                                    <ExternalLink size={14} className="file-path-icon" />
                                  </div>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <div className="file-row-actions">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                  className="file-rerun p-0"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleRerunFile(file);
                                  }}
                                  aria-label={`Rerun ${getDisplayName(file)}`}
                                  >
                                    <RotateCw size={20} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Re-run this file</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                          <AccordionContent value={file}>
                            <div className="case-list">
                              {cases.length === 0 ? (
                                <div className="case-empty">No test cases reported yet</div>
                              ) : (
                                cases.map((testCase) => {
                                  const caseMeta = caseStatusMeta[testCase.status];
                                  return (
                                    <div className="case-row" key={testCase.id}>
                                      <div
                                        className="case-status"
                                        style={{
                                          background: 'transparent',
                                          color: caseMeta.accentColor,
                                        }}
                                        aria-hidden="true"
                                      >
                                        {caseMeta.icon}
                                      </div>
                                      <div className="case-label">{testCase.label}</div>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="case-open-editor p-0"
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openInEditor(
                                                formatOpenTarget(
                                                  testCase.filePath,
                                                  testCase.location,
                                                ),
                                              );
                                            }}
                                            aria-label={`Open ${testCase.label} in editor`}
                                          >
                                            <ExternalLink size={20} />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Open in editor</TooltipContent>
                                      </Tooltip>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
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
                      <p className="placeholder-text">
                        Select a test file on the left to view its run output
                      </p>
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

import { App as AntdApp, theme as antdTheme, ConfigProvider } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactDOM from 'react-dom/client';
import { EmptyPreviewOverlay } from './components/EmptyPreviewOverlay';
import { PreviewHeader } from './components/PreviewHeader';
import { ResizablePanel, ResizablePanelGroup } from './components/Resizable';
import { SidebarHeader } from './components/SidebarHeader';
import { TestFilesHeader } from './components/TestFilesHeader';
import { TestFilesTree } from './components/TestFilesTree';
import { ViewportFrame } from './components/ViewportFrame';
import {
  canPostMessageSource,
  createStaleBrowserRpcDispatchResponse,
  isStaleBrowserRpcRequest,
  readBrowserRpcRequest,
} from './core/browserRpc';
import { forwardDispatchRpcRequest, readDispatchMessage } from './core/channel';
import { createRunId, createRunnerUrl } from './core/runtime';
import { useRpc } from './hooks/useRpc';
import type {
  BrowserClientFileResult,
  BrowserClientTestResult,
  BrowserDispatchRequest,
  BrowserHostConfig,
  FatalPayload,
  LogPayload,
  TestFileInfo,
} from './types';
import type {
  CaseInfo,
  CaseStatus,
  ContainerWindow,
  TestStatus,
} from './utils/constants';
import { logger } from './utils/logger';
import { selectionFromConfig, type ViewportSelection } from './utils/viewport';
import { isDevicePreset } from './utils/viewportPresets';
import './index.css';

// ============================================================================
// Utility Functions
// ============================================================================

const getDisplayName = (testFile: string): string => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
};

const readRunIdFromFrame = (frame: HTMLIFrameElement): string | undefined => {
  try {
    const url = new URL(frame.src, window.location.href);
    return url.searchParams.get('runId') ?? undefined;
  } catch {
    return undefined;
  }
};

const findRunnerFrameByTestPath = (
  testPath: string,
): HTMLIFrameElement | undefined => {
  return Array.from(
    document.querySelectorAll<HTMLIFrameElement>('iframe[data-test-file]'),
  ).find((frame) => frame.dataset.testFile === testPath);
};

// ============================================================================
// App Component
// ============================================================================

type ThemeMode = 'dark' | 'light' | 'system';

const BrowserRunner: React.FC<{
  options: BrowserHostConfig;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}> = ({ options, theme, setTheme }) => {
  const { token } = antdTheme.useToken();

  const [testFiles, setTestFiles] = useState<TestFileInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const [caseMap, setCaseMap] = useState<
    Record<string, Record<string, CaseInfo>>
  >({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [filterText, setFilterText] = useState<string>('');
  const pendingReloadsRef = useRef<
    Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    >
  >(new Map());
  const [runIdByTestFile, setRunIdByTestFile] = useState<
    Record<string, string>
  >({});

  const viewportStorageKey = useCallback(
    (projectName: string) => {
      // Keep key stable but reasonably unique per workspace.
      let hash = 5381;
      for (let i = 0; i < options.rootPath.length; i++) {
        hash = (hash * 33) ^ options.rootPath.charCodeAt(i);
      }
      return `rstest-viewport:${(hash >>> 0).toString(16)}:${projectName}`;
    },
    [options.rootPath],
  );

  const readStoredViewport = useCallback(
    (projectName: string): ViewportSelection | null => {
      try {
        const raw = localStorage.getItem(viewportStorageKey(projectName));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;

        if (!parsed || typeof parsed !== 'object') return null;

        const mode = (parsed as any).mode;
        if (mode === 'full') {
          return { mode: 'full' };
        }
        if (mode === 'responsive') {
          const width = Number((parsed as any).width);
          const height = Number((parsed as any).height);
          if (
            Number.isFinite(width) &&
            width > 0 &&
            Number.isFinite(height) &&
            height > 0
          ) {
            return { mode: 'responsive', width, height };
          }
          return null;
        }
        if (mode === 'preset') {
          const preset = (parsed as any).preset;
          const orientation = (parsed as any).orientation;
          if (
            isDevicePreset(preset) &&
            (orientation === 'portrait' || orientation === 'landscape')
          ) {
            return { mode: 'preset', preset, orientation };
          }
          return null;
        }

        return null;
      } catch {
        return null;
      }
    },
    [viewportStorageKey],
  );

  const writeStoredViewport = useCallback(
    (projectName: string, value: ViewportSelection) => {
      try {
        localStorage.setItem(
          viewportStorageKey(projectName),
          JSON.stringify(value),
        );
      } catch {
        // ignore
      }
    },
    [viewportStorageKey],
  );

  const [viewportByProject, setViewportByProject] = useState<
    Record<string, ViewportSelection>
  >(() => {
    const initial: Record<string, ViewportSelection> = {};
    for (const project of options.projects ?? []) {
      initial[project.name] =
        readStoredViewport(project.name) ??
        selectionFromConfig(project.viewport as any);
    }
    return initial;
  });

  useEffect(() => {
    setViewportByProject((prev) => {
      const next: Record<string, ViewportSelection> = { ...prev };
      for (const project of options.projects ?? []) {
        if (!next[project.name]) {
          next[project.name] =
            readStoredViewport(project.name) ??
            selectionFromConfig(project.viewport as any);
        }
      }
      return next;
    });
  }, [options.projects, readStoredViewport]);

  const handleReloadTestFile = useCallback(
    async (testFile: string, testNamePattern?: string) => {
      logger.debug(
        '[Container] handleReloadTestFile called:',
        testFile,
        testNamePattern,
      );
      return new Promise<void>((resolve, reject) => {
        const previousPending = pendingReloadsRef.current.get(testFile);
        if (previousPending) {
          previousPending.reject(
            new Error(
              `Reload for "${testFile}" was superseded by a newer request.`,
            ),
          );
        }
        pendingReloadsRef.current.set(testFile, { resolve, reject });

        const iframe = document.querySelector<HTMLIFrameElement>(
          `iframe[data-test-file="${testFile}"]`,
        );
        logger.debug('[Container] Found iframe:', iframe);
        if (!iframe) {
          pendingReloadsRef.current.delete(testFile);
          reject(
            new Error(
              `Cannot reload test file "${testFile}": iframe not found`,
            ),
          );
          return;
        }
        const nextRunId = createRunId();
        setRunIdByTestFile((prev) => ({
          ...prev,
          [testFile]: nextRunId,
        }));
        setStatusMap((prev) => ({ ...prev, [testFile]: 'running' }));
        setCaseMap((prev) => {
          const prevFile = prev[testFile] ?? {};
          const updatedCases: Record<string, CaseInfo> = {};
          for (const [key, caseInfo] of Object.entries(prevFile)) {
            updatedCases[key] = { ...caseInfo, status: 'running' };
          }
          return { ...prev, [testFile]: updatedCases };
        });
        const newSrc = createRunnerUrl(
          testFile,
          options.runnerUrl,
          testNamePattern,
          false,
          nextRunId,
        );
        logger.debug('[Container] Setting iframe.src to:', newSrc);
        iframe.src = newSrc;
      });
    },
    [options.runnerUrl],
  );

  const { rpc, loading, connected } = useRpc(
    setTestFiles,
    options?.wsPort,
    handleReloadTestFile,
  );

  useEffect(() => {
    return () => {
      if (pendingReloadsRef.current.size === 0) {
        return;
      }
      const unmountError = new Error(
        'Browser runner unmounted before reload completed',
      );
      for (const pending of pendingReloadsRef.current.values()) {
        pending.reject(unmountError);
      }
      pendingReloadsRef.current.clear();
    };
  }, []);

  // Consolidated effect for handling testFiles changes
  // Handles statusMap, caseMap, openFiles initialization and cleanup
  useEffect(() => {
    // Update statusMap: preserve existing status, set new files to 'idle'
    setStatusMap((prev) => {
      const next: Record<string, TestStatus> = {};
      for (const file of testFiles) {
        next[file.testPath] = prev[file.testPath] ?? 'idle';
      }
      return next;
    });

    // Update caseMap: preserve existing cases, initialize new files with empty object
    setCaseMap((prev) => {
      const next: Record<string, Record<string, CaseInfo>> = {};
      for (const file of testFiles) {
        next[file.testPath] = prev[file.testPath] ?? {};
      }
      return next;
    });

    setRunIdByTestFile((prev) => {
      const next: Record<string, string> = {};
      for (const file of testFiles) {
        next[file.testPath] = prev[file.testPath] ?? createRunId();
      }
      return next;
    });

    // Clean up openFiles: remove files that no longer exist
    const testPaths = testFiles.map((f) => f.testPath);
    setOpenFiles((prev) => prev.filter((file) => testPaths.includes(file)));

    // Auto-select first file if none selected
    setActive((prev) => {
      if (!prev && testFiles.length > 0) {
        return testFiles[0]!.testPath;
      }
      // If current active file was removed, select first file
      if (prev && !testPaths.includes(prev) && testFiles.length > 0) {
        return testFiles[0]!.testPath;
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
      setActive(file);
      if (rpc && connected) {
        void rpc.rerunTest(file);
      }
    },
    [rpc, connected],
  );

  const handleRerunTestCase = useCallback(
    (file: string, testName: string) => {
      setActive(file);
      if (rpc && connected) {
        void rpc.rerunTest(file, testName);
      }
    },
    [rpc, connected],
  );

  const handleRerunAll = useCallback(() => {
    if (rpc && connected) {
      for (const file of testFiles) {
        void rpc.rerunTest(file.testPath);
      }
    }
  }, [testFiles, rpc, connected]);

  // Handle messages from test runner iframes
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = readDispatchMessage(event);
      if (!message) {
        return;
      }

      if (message.type === 'file-start') {
        const payload = message.payload as {
          testPath?: string;
          projectName?: string;
        };
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
          rpc?.onTestFileStart({
            testPath,
            projectName: payload.projectName ?? '',
          });
        }
      } else if (message.type === 'case-result') {
        const payload = message.payload as BrowserClientTestResult;
        if (payload?.testPath) {
          upsertCase(payload.testPath, payload);
          rpc?.onTestCaseResult(payload);
        }
      } else if (message.type === 'file-complete') {
        const payload = message.payload as BrowserClientFileResult;
        const testPath = payload.testPath;
        if (typeof testPath === 'string') {
          const passed = payload.status === 'pass' || payload.status === 'skip';
          setStatusMap((prev) => ({
            ...prev,
            [testPath]: passed ? 'pass' : 'fail',
          }));
          setCaseMap((prev) => {
            const newCases: Record<string, CaseInfo> = {};
            for (const result of payload.results ?? []) {
              if (result?.testId) {
                const parentNames = (result.parentNames ?? []).filter(Boolean);
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
          const pending = pendingReloadsRef.current.get(testPath);
          if (pending) {
            pendingReloadsRef.current.delete(testPath);
            pending.resolve();
          }
          rpc?.onTestFileComplete(payload);
        }
      } else if (message.type === 'fatal') {
        const payload = message.payload as FatalPayload;
        if (active) {
          setStatusMap((prev) => ({ ...prev, [active]: 'fail' }));
        }
        if (pendingReloadsRef.current.size > 0) {
          const fatalError = new Error(
            payload.message || 'Browser runner fatal',
          );
          for (const pending of pendingReloadsRef.current.values()) {
            pending.reject(fatalError);
          }
          pendingReloadsRef.current.clear();
        }
        rpc?.onFatal(payload);
      } else if (message.type === 'log') {
        const payload = message.payload as LogPayload;
        rpc?.onLog(payload);
      } else if (message.type === 'dispatch-rpc-request') {
        // Unified RPC path for snapshot and future runner-side capabilities.
        const dispatchRequest = message.payload as BrowserDispatchRequest;
        const browserRpcRequest = readBrowserRpcRequest(dispatchRequest);

        if (browserRpcRequest) {
          const currentFrame = findRunnerFrameByTestPath(
            browserRpcRequest.testPath,
          );
          const currentRunId = currentFrame
            ? readRunIdFromFrame(currentFrame)
            : undefined;

          if (isStaleBrowserRpcRequest(browserRpcRequest, currentRunId)) {
            if (canPostMessageSource(event.source)) {
              event.source.postMessage(
                {
                  type: '__rstest_dispatch_response__',
                  payload: createStaleBrowserRpcDispatchResponse(
                    dispatchRequest.requestId,
                    browserRpcRequest,
                    currentRunId,
                  ),
                },
                '*',
              );
            }
            return;
          }
        }

        void forwardDispatchRpcRequest(rpc, dispatchRequest, event.source);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [active, upsertCase, mapCaseStatus, rpc]);

  // Computed values - case level statistics
  const caseCounts = useMemo(() => {
    const allCases = Object.values(caseMap).flatMap((cases) =>
      Object.values(cases),
    );
    return {
      idle: allCases.filter((c) => c.status === 'idle').length,
      running: allCases.filter((c) => c.status === 'running').length,
      pass: allCases.filter((c) => c.status === 'pass').length,
      fail: allCases.filter((c) => c.status === 'fail').length,
      skip: allCases.filter((c) => c.status === 'skip').length,
    };
  }, [caseMap]);

  const isAnyFileRunning = useMemo(
    () => Object.values(statusMap).some((s) => s === 'running'),
    [statusMap],
  );

  // Collect all expandable node keys for expand/collapse all functionality
  const allExpandableKeys = useMemo(() => {
    const keys: string[] = [];

    // Get unique project names
    const projectNames = [...new Set(testFiles.map((f) => f.projectName))];
    const hasMultipleProjects = projectNames.length > 1;

    // Add project keys if multiple projects
    if (hasMultipleProjects) {
      for (const projectName of projectNames) {
        keys.push(`__project__${projectName}`);
      }
    }

    // Add file keys and suite keys
    for (const file of testFiles) {
      const filePath = file.testPath;
      keys.push(filePath);

      // Collect all unique suite paths from cases
      const cases = Object.values(caseMap[filePath] ?? {});
      const suitePaths = new Set<string>();

      for (const testCase of cases) {
        const parentNames = testCase.parentNames;
        // Build all ancestor suite keys
        for (let i = 1; i <= parentNames.length; i++) {
          const suitePath = parentNames.slice(0, i).join('::');
          suitePaths.add(suitePath);
        }
      }

      // Add suite keys - need to match the key format in TestFilesTree
      // Key format: ${keyPrefix}::suite::${fullPath.join('::')}
      // where keyPrefix accumulates from parent suites
      for (const suitePath of suitePaths) {
        const parts = suitePath.split('::');
        // Build the actual key by accumulating prefixes
        let currentKey = filePath;
        for (let i = 1; i <= parts.length; i++) {
          const partialPath = parts.slice(0, i).join('::');
          currentKey = `${currentKey}::suite::${partialPath}`;
        }
        keys.push(currentKey);
      }
    }

    return [...new Set(keys)]; // Deduplicate
  }, [testFiles, caseMap]);

  // Generate project-specific storage key for split position
  const projectKey =
    options.projects?.[0]?.name ||
    options.rootPath.split('/').filter(Boolean).pop() ||
    'default';
  const splitStorageKey = `rstest-split-${projectKey}`;

  const projectDefaults = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const p of options.projects ?? []) {
      map.set(p.name, (p as any).viewport);
    }
    return map;
  }, [options.projects]);

  const activeProjectName = useMemo(() => {
    if (!active) {
      return options.projects?.[0]?.name;
    }
    const entry = testFiles.find((f) => f.testPath === active);
    return entry?.projectName ?? options.projects?.[0]?.name;
  }, [active, testFiles, options.projects]);

  const activeViewport = useMemo<ViewportSelection>(() => {
    if (!activeProjectName) {
      return { mode: 'full' };
    }
    return (
      viewportByProject[activeProjectName] ??
      selectionFromConfig(projectDefaults.get(activeProjectName) as any)
    );
  }, [activeProjectName, viewportByProject, projectDefaults]);

  const handleViewportChange = useCallback(
    (next: ViewportSelection) => {
      if (!activeProjectName) return;
      writeStoredViewport(activeProjectName, next);
      setViewportByProject((prev) => ({ ...prev, [activeProjectName]: next }));
    },
    [activeProjectName, writeStoredViewport],
  );

  const handleResponsiveResize = useCallback(
    (projectName: string, size: { width: number; height: number }) => {
      setViewportByProject((prev) => {
        const current = prev[projectName];
        if (!current || current.mode !== 'responsive') {
          return prev;
        }

        if (current.width === size.width && current.height === size.height) {
          return prev;
        }

        const next: ViewportSelection = {
          mode: 'responsive',
          width: size.width,
          height: size.height,
        };
        writeStoredViewport(projectName, next);
        return { ...prev, [projectName]: next };
      });
    },
    [writeStoredViewport],
  );

  return (
    <div
      className="m-0 h-screen w-full overflow-hidden p-0"
      style={{ background: token.colorBgContainer }}
    >
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full w-full"
        autoSaveId={splitStorageKey}
      >
        <ResizablePanel defaultSize={32} minSize={20} maxSize={50}>
          <div
            className="flex h-full flex-col overflow-hidden"
            style={{
              background: token.colorBgContainer,
            }}
          >
            <SidebarHeader
              theme={theme}
              onThemeToggle={setTheme}
              isConnected={connected}
              token={token}
              counts={caseCounts}
            />

            <TestFilesHeader
              token={token}
              filterText={filterText}
              onFilterChange={setFilterText}
              isAllExpanded={
                allExpandableKeys.length > 0 &&
                allExpandableKeys.every((key) => openFiles.includes(key))
              }
              onToggleExpandAll={() => {
                const isAllExpanded =
                  allExpandableKeys.length > 0 &&
                  allExpandableKeys.every((key) => openFiles.includes(key));
                if (isAllExpanded) {
                  setOpenFiles([]);
                } else {
                  // Expand all nodes (files, suites, projects)
                  setOpenFiles(allExpandableKeys);
                }
              }}
              onRerun={connected ? handleRerunAll : undefined}
              counts={caseCounts}
              isRunning={isAnyFileRunning}
            />

            <div
              className="flex-1 overflow-x-hidden overflow-y-auto"
              style={{ background: token.colorBgContainer }}
            >
              <TestFilesTree
                testFiles={testFiles}
                statusMap={statusMap}
                caseMap={caseMap}
                rootPath={options.rootPath}
                projects={options.projects}
                loading={loading}
                connected={connected}
                openFiles={openFiles}
                activeFile={active}
                token={token}
                filterText={filterText}
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
              activeFile={active ?? undefined}
              rootPath={options.rootPath}
              status={active ? (statusMap[active] ?? 'idle') : undefined}
              viewport={activeProjectName ? activeViewport : undefined}
              onViewportChange={
                activeProjectName ? handleViewportChange : undefined
              }
            />

            <div
              className="relative min-h-0 flex-1 overflow-auto"
              style={{ background: token.colorBgLayout }}
            >
              {!active && (
                <EmptyPreviewOverlay message="Select a test file on the left to view its run output" />
              )}
              {testFiles.map((fileInfo) =>
                (() => {
                  const isActive = fileInfo.testPath === active;
                  const runId = runIdByTestFile[fileInfo.testPath];
                  if (!runId) {
                    return null;
                  }
                  const selection =
                    viewportByProject[fileInfo.projectName] ??
                    selectionFromConfig(
                      projectDefaults.get(fileInfo.projectName) as any,
                    );
                  const onLoad = (
                    event: React.SyntheticEvent<HTMLIFrameElement>,
                  ) => {
                    const frame = event.currentTarget;
                    const frameRunId = readRunIdFromFrame(frame) ?? runId;
                    if (frame.contentWindow) {
                      frame.contentWindow.postMessage(
                        {
                          type: 'RSTEST_CONFIG',
                          payload: {
                            ...options,
                            testFile: fileInfo.testPath,
                            runId: frameRunId,
                          },
                        },
                        '*',
                      );
                    }
                  };

                  return (
                    <div
                      key={fileInfo.testPath}
                      className="h-full w-full"
                      style={{ display: isActive ? 'block' : 'none' }}
                    >
                      <ViewportFrame
                        token={token}
                        selection={selection}
                        active={isActive}
                        onResponsiveResize={
                          selection.mode === 'responsive'
                            ? (nextSize) =>
                                handleResponsiveResize(
                                  fileInfo.projectName,
                                  nextSize,
                                )
                            : undefined
                        }
                        data-testid={
                          selection.mode === 'responsive'
                            ? 'viewport-resizer'
                            : undefined
                        }
                        data-test-project={fileInfo.projectName}
                        data-test-file={fileInfo.testPath}
                      >
                        <iframe
                          data-test-file={fileInfo.testPath}
                          title={`Test runner for ${getDisplayName(fileInfo.testPath)}`}
                          src={createRunnerUrl(
                            fileInfo.testPath,
                            options.runnerUrl,
                            undefined,
                            false,
                            runId,
                          )}
                          className="block h-full w-full border-0"
                          style={{ background: token.colorBgContainer }}
                          onLoad={onLoad}
                        />
                      </ViewportFrame>
                    </div>
                  );
                })(),
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

const App: React.FC = () => {
  const options = (window as ContainerWindow).__RSTEST_BROWSER_OPTIONS__;
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? 'dark' : 'light');
    setSystemTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('rstest-theme');
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeMode(stored as ThemeMode);
      }
    } catch {
      // ignore
    }
  }, []);

  const theme = themeMode === 'system' ? systemTheme : themeMode;

  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      window.localStorage.setItem('rstest-theme', themeMode);
    } catch {
      // ignore
    }
  }, [theme, themeMode]);

  if (!options) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white">
        Missing browser options
      </div>
    );
  }

  const isDark = theme === 'dark';
  const projectName =
    options.projects?.[0]?.name ||
    options.rootPath.split('/').filter(Boolean).pop() ||
    'rstest';

  useEffect(() => {
    document.title = `${projectName} [RSTEST BROWSER]`;
  }, [projectName]);

  return (
    <ConfigProvider
      componentSize="small"
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          fontFamily: '"Inter",system-ui,-apple-system,"Segoe UI",sans-serif',
          fontFamilyCode:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          colorInfo: '#0070f3',
          colorPrimary: '#0070f3',
          colorSuccess: '#45a557',
          colorError: isDark ? '#d93036' : '#da2f35',
          colorWarning: '#ffb224',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        <BrowserRunner
          options={options}
          theme={themeMode}
          setTheme={setThemeMode}
        />
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

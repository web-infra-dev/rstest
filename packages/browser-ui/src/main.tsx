import {
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_RPC_REQUEST_TYPE,
  RSTEST_CONFIG_MESSAGE_TYPE,
} from '@rstest/browser/protocol';
import { App as AntdApp, theme as antdTheme, ConfigProvider } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
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
  buildCollectedCaseMap,
  projectCaseInfo,
  upsertRunningCase,
} from './core/caseMap';
import { projectKey as toProjectKey, suiteKey } from './core/treeNodeKey';
import { forwardDispatchRpcRequest, readRunnerEnvelope } from './core/channel';
import { createFrameLeaseTable } from './core/frames';
import { createRunnerUrl, resolveRunnerBase } from './core/runtime';
import { useRpc } from './hooks/useRpc';
import type {
  BrowserClientFileResult,
  BrowserClientTestResult,
  BrowserDispatchRequest,
  BrowserHostConfig,
  TestCaseStartPayload,
  TestFileReadyPayload,
  VersionedTestFileSet,
} from './types';
import type {
  CaseInfo,
  CaseStatus,
  ContainerWindow,
  TestStatus,
} from './utils/constants';
import { logger } from './utils/logger';
import {
  isPositiveFiniteSize,
  selectionFromConfig,
  type ViewportSelection,
} from './utils/viewport';
import { isDevicePreset } from './utils/viewportPresets';
import './index.css';

// ============================================================================
// Utility Functions
// ============================================================================

const getDisplayName = (testFile: string): string => {
  const parts = testFile.split('/');
  return parts[parts.length - 1] || testFile;
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

  const [fileSet, setFileSet] = useState<VersionedTestFileSet>({
    files: [],
    version: 0,
  });
  const testFiles = fileSet.files;
  const [active, setActive] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, TestStatus>>({});
  const [caseMap, setCaseMap] = useState<
    Record<string, Record<string, CaseInfo>>
  >({});
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [filterText, setFilterText] = useState<string>('');

  // Leases live in a ref, never in React state: the lease must be current at
  // the instant a `load` event fires, and a grant is a synchronous write
  // inside `handleReloadTestFile` — before any render, any navigation, or the
  // birpc reply. `bumpLeases` only schedules the re-render that lets the grant
  // reach the DOM.
  const leasesRef = useRef(createFrameLeaseTable());
  const [, bumpLeases] = useReducer((epoch: number) => epoch + 1, 0);

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
          return isPositiveFiniteSize(width, height)
            ? { mode: 'responsive', width, height }
            : null;
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
    async (testFile: string, runId: string, testNamePattern?: string) => {
      logger.debug(
        '[Container] Granting run',
        runId,
        'to',
        testFile,
        testNamePattern ?? '',
      );
      setActive(testFile);

      // The grant is SYNCHRONOUS and precedes the render that navigates: a
      // `load` firing at any later instant (the granted navigation, an HMR
      // full reload, a stray in-flight one) reads this lease and confers the
      // current identity on whatever document booted.
      leasesRef.current.grant(testFile, runId, testNamePattern);
      bumpLeases();

      setStatusMap((prev) => ({ ...prev, [testFile]: 'running' }));
      setCaseMap((prev) => {
        const prevFile = prev[testFile] ?? {};
        const updatedCases: Record<string, CaseInfo> = {};
        for (const [key, caseInfo] of Object.entries(prevFile)) {
          updatedCases[key] = { ...caseInfo, status: 'running' };
        }
        return { ...prev, [testFile]: updatedCases };
      });
    },
    [],
  );

  const { rpc, loading, connected } = useRpc(
    setFileSet,
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

    // Drop leases whose file left the set; the host has already settled those
    // runs (`retainPaths` runs before the container is told), so this is pure
    // container-side cleanup.
    const testPaths = testFiles.map((f) => f.testPath);
    leasesRef.current.retain(testPaths);
    bumpLeases();
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

  useEffect(() => {
    if (!rpc || !connected || fileSet.version === 0) {
      return;
    }

    // Runs after the commit for this version: every iframe for the set is in
    // the DOM, so the host may start granting runs against it.
    void rpc.onFrameSetReady(fileSet.version).catch((error) => {
      logger.debug('[Container RPC] Failed to notify frame set ready:', error);
    });
  }, [rpc, connected, fileSet]);

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
      // Project via the shared owner WITHOUT previousCase so the three-tier
      // filePath / location?? fallback collapses to the two-tier
      // `testPath || filePath` and bare `location` this path has always used.
      const next = projectCaseInfo({
        filePath,
        test: payload,
        status: mapCaseStatus(payload.status),
      });
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};
        return {
          ...prev,
          [filePath]: {
            ...prevFile,
            [payload.testId]: next,
          },
        };
      });
    },
    [mapCaseStatus],
  );

  const syncCollectedCases = useCallback(
    (filePath: string, payload: TestFileReadyPayload) => {
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};
        const nextFile = buildCollectedCaseMap({
          filePath,
          tests: payload.tests,
          previousCases: prevFile,
        });

        return {
          ...prev,
          [filePath]: nextFile,
        };
      });
    },
    [],
  );

  const syncStartedCase = useCallback(
    (filePath: string, payload: TestCaseStartPayload) => {
      setCaseMap((prev) => {
        const prevFile = prev[filePath] ?? {};

        return {
          ...prev,
          [filePath]: upsertRunningCase({
            filePath,
            test: payload,
            previousCases: prevFile,
          }),
        };
      });
    },
    [],
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

  // Fire-and-forget relay of a runner message to the host's one dispatch
  // gate, stamped with the envelope's identity. The container adjudicates
  // nothing: whether the run is live is the host registry's question.
  const forwardCounterRef = useRef(0);
  const forwardRunnerMessage = useCallback(
    (runId: string | undefined, method: string, args: unknown): void => {
      if (!rpc) {
        return;
      }
      forwardCounterRef.current += 1;
      void rpc
        .dispatch({
          requestId: `container-runner-${forwardCounterRef.current}`,
          runId,
          namespace: DISPATCH_NAMESPACE_RUNNER,
          method,
          args,
        })
        .catch((error) => {
          logger.debug(
            '[Container] Failed to forward runner message:',
            method,
            error,
          );
        });
    },
    [rpc],
  );

  // Handle messages from test runner iframes
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const envelope = readRunnerEnvelope(event);
      if (!envelope) {
        return;
      }
      const message = envelope.message;

      if (message.type === DISPATCH_RPC_REQUEST_TYPE) {
        // Unified RPC path for snapshot and future runner-side capabilities.
        const dispatchRequest = message.payload as BrowserDispatchRequest;

        if (
          dispatchRequest.namespace === DISPATCH_NAMESPACE_RUNNER &&
          dispatchRequest.method === 'file-ready'
        ) {
          const payload = dispatchRequest.args as TestFileReadyPayload;

          if (
            typeof payload?.testPath === 'string' &&
            Array.isArray(payload.tests)
          ) {
            syncCollectedCases(payload.testPath, payload);
          }
        }

        if (
          dispatchRequest.namespace === DISPATCH_NAMESPACE_RUNNER &&
          dispatchRequest.method === 'case-start'
        ) {
          const payload = dispatchRequest.args as TestCaseStartPayload;

          if (typeof payload?.testPath === 'string' && payload.testId) {
            syncStartedCase(payload.testPath, payload);
          }
        }

        void forwardDispatchRpcRequest(rpc, dispatchRequest, event.source);
        return;
      }

      // UI projection first, then one uniform forward — the host's registry
      // decides staleness, so the projection here is display-optimistic.
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
        }
      } else if (message.type === 'case-result') {
        const payload = message.payload as BrowserClientTestResult;
        if (payload?.testPath) {
          upsertCase(payload.testPath, payload);
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
                // Same shared projection, without previousCase: the file's
                // `testPath` is the two-tier filePath fallback, location stays
                // bare — byte-identical to the previous inline literal.
                newCases[result.testId] = projectCaseInfo({
                  filePath: testPath,
                  test: result,
                  status: mapCaseStatus(result.status),
                });
              }
            }
            return { ...prev, [testPath]: newCases };
          });
        }
      } else if (message.type === 'fatal') {
        if (active) {
          setStatusMap((prev) => ({ ...prev, [active]: 'fail' }));
        }
      }

      forwardRunnerMessage(
        envelope.runId,
        message.type,
        'payload' in message ? message.payload : undefined,
      );
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [
    active,
    upsertCase,
    mapCaseStatus,
    rpc,
    forwardRunnerMessage,
    syncCollectedCases,
    syncStartedCase,
  ]);

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
        keys.push(toProjectKey(projectName));
      }
    }

    // Add file keys and suite keys
    for (const file of testFiles) {
      const filePath = file.testPath;
      keys.push(filePath);

      // Enumerate every ancestor suite key straight from each case's
      // parentNames array — via the shared grammar, never a join→split
      // round-trip — so the keys match the producer byte-for-byte even when a
      // suite name itself contains a literal '::'.
      const cases = Object.values(caseMap[filePath] ?? {});
      for (const testCase of cases) {
        const { parentNames } = testCase;
        for (let i = 1; i <= parentNames.length; i++) {
          keys.push(suiteKey(filePath, parentNames.slice(0, i)));
        }
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
                  // Reading the ref during render is safe here: every lease
                  // mutation calls `bumpLeases`, so this render is never behind
                  // the table.
                  const lease = leasesRef.current.get(fileInfo.testPath);
                  const selection =
                    viewportByProject[fileInfo.projectName] ??
                    selectionFromConfig(
                      projectDefaults.get(fileInfo.projectName) as any,
                    );
                  const onLoad = (
                    event: React.SyntheticEvent<HTMLIFrameElement>,
                  ) => {
                    // Confer the frame's CURRENT lease on whatever document
                    // just booted — the granted navigation and an HMR full
                    // reload alike. The lease ref was written synchronously at
                    // grant, so it can never be behind this event; a document
                    // in a frame with no lease is told nothing and stays
                    // silent.
                    const currentLease = leasesRef.current.get(
                      fileInfo.testPath,
                    );
                    if (!currentLease) {
                      return;
                    }
                    event.currentTarget.contentWindow?.postMessage(
                      {
                        type: RSTEST_CONFIG_MESSAGE_TYPE,
                        payload: {
                          ...options,
                          testFile: fileInfo.testPath,
                          runId: currentLease.runId,
                        },
                      },
                      '*',
                    );
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
                          // The boot counter in the key mounts a FRESH
                          // browsing context per grant: no document from a
                          // previous run can survive into this one, so "two
                          // documents, one run" is unrepresentable.
                          key={`${fileInfo.testPath}#${lease?.boot ?? 0}`}
                          data-test-file={fileInfo.testPath}
                          data-test-project={fileInfo.projectName}
                          title={`Test runner for ${getDisplayName(fileInfo.testPath)}`}
                          src={
                            lease
                              ? createRunnerUrl(
                                  fileInfo.testPath,
                                  resolveRunnerBase(
                                    options,
                                    fileInfo.projectName,
                                  ),
                                  lease.testNamePattern,
                                )
                              : 'about:blank'
                          }
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

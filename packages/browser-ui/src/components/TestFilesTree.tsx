import { Skeleton, Tree, Typography } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import type { DataNode } from 'antd/es/tree';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import type { BrowserProjectRuntime, TestFileInfo } from '../types';
import {
  CASE_STATUS_META,
  type CaseInfo,
  type CaseStatus,
  STATUS_META,
  type TestStatus,
} from '../utils/constants';
import { TestCaseTitle } from './TestCaseTitle';
import { TestFileTitle } from './TestFileTitle';
import { TestSuiteTitle } from './TestSuiteTitle';

const { Text } = Typography;

// ============================================================================
// Utility Functions
// ============================================================================

const toRelativePath = (file: string, rootPath?: string): string => {
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

const openInEditor = (file: string): void => {
  const payload = { type: 'open-in-editor', payload: { file } };
  window.parent?.postMessage(payload, '*');
  fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`).catch(() => {});
};

// ============================================================================
// Types
// ============================================================================

export type TestFilesTreeProps = {
  testFiles: TestFileInfo[];
  statusMap: Record<string, TestStatus>;
  caseMap: Record<string, Record<string, CaseInfo>>;
  rootPath?: string;
  projects: BrowserProjectRuntime[];
  loading: boolean;
  connected: boolean;
  openFiles: string[];
  activeFile: string | null;
  token: GlobalToken;
  filterText: string;
  onExpandChange: (keys: string[]) => void;
  onSelect: (file: string) => void;
  onRerunFile: (file: string) => void;
  onRerunTestCase: (file: string, testName: string) => void;
};

// ============================================================================
// Internal Tree Node Type
// ============================================================================

type TreeNode = {
  name: string;
  fullPath: string[];
  children: Map<string, TreeNode>;
  cases: CaseInfo[];
  status: CaseStatus;
};

// ============================================================================
// TestFilesTree Component
// ============================================================================

export const TestFilesTree: React.FC<TestFilesTreeProps> = ({
  testFiles,
  statusMap,
  caseMap,
  rootPath,
  projects,
  loading,
  connected,
  openFiles,
  activeFile,
  token,
  filterText,
  onExpandChange,
  onSelect,
  onRerunFile,
  onRerunTestCase,
}) => {
  // Filter test files and cases based on filterText
  const { filteredTestFiles, filteredCaseMap } = useMemo(() => {
    if (!filterText.trim()) {
      return { filteredTestFiles: testFiles, filteredCaseMap: caseMap };
    }

    const lowerFilter = filterText.toLowerCase();
    const newFilteredFiles: TestFileInfo[] = [];
    const newFilteredCaseMap: Record<string, Record<string, CaseInfo>> = {};

    for (const file of testFiles) {
      const filePath = file.testPath;
      const fileMatches = filePath.toLowerCase().includes(lowerFilter);
      const cases = caseMap[filePath] ?? {};

      // Filter cases that match
      const matchingCases: Record<string, CaseInfo> = {};
      for (const [caseId, caseInfo] of Object.entries(cases)) {
        if (
          caseInfo.name.toLowerCase().includes(lowerFilter) ||
          caseInfo.fullName.toLowerCase().includes(lowerFilter)
        ) {
          matchingCases[caseId] = caseInfo;
        }
      }

      // Include file if file name matches or any case matches
      if (fileMatches || Object.keys(matchingCases).length > 0) {
        newFilteredFiles.push(file);
        // If file name matches, show all cases; otherwise show only matching cases
        newFilteredCaseMap[filePath] = fileMatches ? cases : matchingCases;
      }
    }

    return {
      filteredTestFiles: newFilteredFiles,
      filteredCaseMap: newFilteredCaseMap,
    };
  }, [testFiles, caseMap, filterText]);

  // Build nested tree structure from flat cases
  const buildNestedTree = useCallback(
    (file: string, cases: CaseInfo[]): DataNode[] => {
      if (cases.length === 0) {
        return [
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
        ];
      }

      const root: TreeNode = {
        name: '',
        fullPath: [],
        children: new Map(),
        cases: [],
        status: 'idle',
      };

      for (const testCase of cases) {
        let current = root;
        const path = testCase.parentNames;

        for (let i = 0; i < path.length; i++) {
          const name = path[i]!;
          const fullPath = path.slice(0, i + 1);
          if (!current.children.has(name)) {
            current.children.set(name, {
              name,
              fullPath,
              children: new Map(),
              cases: [],
              status: 'idle',
            });
          }
          current = current.children.get(name)!;
        }

        current.cases.push(testCase);
      }

      const calcStatus = (node: TreeNode): CaseStatus => {
        const childStatuses: CaseStatus[] = [];

        for (const child of node.children.values()) {
          childStatuses.push(calcStatus(child));
        }

        for (const c of node.cases) {
          childStatuses.push(c.status);
        }

        if (childStatuses.some((s) => s === 'fail')) return 'fail';
        if (childStatuses.some((s) => s === 'running')) return 'running';
        if (childStatuses.every((s) => s === 'pass')) return 'pass';
        if (childStatuses.every((s) => s === 'skip')) return 'skip';
        if (childStatuses.some((s) => s === 'pass')) return 'pass';
        return 'idle';
      };

      const toDataNodes = (node: TreeNode, keyPrefix: string): DataNode[] => {
        const result: DataNode[] = [];

        for (const child of node.children.values()) {
          const suiteStatus = calcStatus(child);
          const suiteMeta = CASE_STATUS_META[suiteStatus];
          const suiteKey = `${keyPrefix}::suite::${child.fullPath.join('::')}`;
          const suiteFullName = child.fullPath.join('  ');

          result.push({
            key: suiteKey,
            title: (
              <TestSuiteTitle
                icon={suiteMeta.icon}
                iconColor={suiteMeta.color}
                status={suiteStatus}
                name={child.name}
                onRerun={
                  connected
                    ? () => {
                        onRerunTestCase(file, suiteFullName);
                      }
                    : undefined
                }
                buttonTextColor={token.colorTextSecondary}
              />
            ),
            children: toDataNodes(child, suiteKey),
            selectable: false,
          });
        }

        for (const testCase of node.cases) {
          const caseMeta = CASE_STATUS_META[testCase.status];
          result.push({
            key: `${keyPrefix}::case::${testCase.id}`,
            title: (
              <TestCaseTitle
                icon={caseMeta.icon}
                iconColor={caseMeta.color}
                status={testCase.status}
                label={testCase.name}
                onRerun={
                  connected
                    ? () => {
                        onRerunTestCase(file, testCase.fullName);
                      }
                    : undefined
                }
                buttonTextColor={token.colorTextSecondary}
              />
            ),
            isLeaf: true,
            selectable: false,
          });
        }

        return result;
      };

      return toDataNodes(root, file);
    },
    [connected, onRerunTestCase, token.colorTextSecondary],
  );

  const treeData: DataNode[] = useMemo(() => {
    // Get unique project names from test files
    const projectNames = [
      ...new Set(filteredTestFiles.map((f) => f.projectName)),
    ];

    // Build a map from project name to projectRoot for relative path calculation
    const projectRootMap = new Map<string, string>();
    for (const project of projects) {
      projectRootMap.set(project.name, project.projectRoot);
    }

    // Build file nodes helper - uses project-specific root for relative path
    const buildFileNode = (
      fileInfo: TestFileInfo,
      projectRoot?: string,
    ): DataNode => {
      const filePath = fileInfo.testPath;
      const status = statusMap[filePath] ?? 'idle';
      const meta = STATUS_META[status];
      // Use projectRoot if available, otherwise fall back to rootPath
      const relativePath = toRelativePath(filePath, projectRoot ?? rootPath);
      const cases = Object.values(filteredCaseMap[filePath] ?? {});

      return {
        key: filePath,
        title: (
          <TestFileTitle
            icon={meta.icon}
            iconColor={meta.color}
            status={status}
            relativePath={relativePath}
            onOpen={() => openInEditor(filePath)}
            onRerun={
              connected
                ? () => {
                    onRerunFile(filePath);
                  }
                : undefined
            }
            textColor={token.colorTextSecondary}
          />
        ),
        children: buildNestedTree(filePath, cases),
      };
    };

    // Only show project level when there are multiple projects (explicit config)
    // When there's only one project, it's likely the default project without explicit config
    if (projectNames.length > 1) {
      return projectNames.map((projectName) => {
        const projectFiles = filteredTestFiles.filter(
          (f) => f.projectName === projectName,
        );
        const projectKey = `__project__${projectName}`;
        const projectRoot = projectRootMap.get(projectName);

        // Calculate project status based on file statuses
        const fileStatuses = projectFiles.map(
          (f) => statusMap[f.testPath] ?? 'idle',
        );
        let projectStatus: TestStatus = 'idle';
        if (fileStatuses.some((s) => s === 'fail')) {
          projectStatus = 'fail';
        } else if (fileStatuses.some((s) => s === 'running')) {
          projectStatus = 'running';
        } else if (
          fileStatuses.length > 0 &&
          fileStatuses.every((s) => s === 'pass')
        ) {
          projectStatus = 'pass';
        }
        const projectMeta = STATUS_META[projectStatus];

        return {
          key: projectKey,
          title: (
            <div className="flex items-center gap-1.5">
              <Package
                size={14}
                style={{ color: projectMeta.color }}
                strokeWidth={2.5}
                className="shrink-0"
              />
              <span
                className="truncate text-sm font-medium"
                style={{ color: token.colorText }}
              >
                {projectName}
              </span>
            </div>
          ),
          children: projectFiles.map((f) => buildFileNode(f, projectRoot)),
          selectable: false,
        };
      });
    }

    // No projects: flat file list (backward compatible for non-project configs)
    return filteredTestFiles.map((f) => buildFileNode(f));
  }, [
    buildNestedTree,
    filteredCaseMap,
    connected,
    onRerunFile,
    projects,
    rootPath,
    statusMap,
    filteredTestFiles,
    token,
  ]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton.Avatar active size="small" shape="circle" />
            <Skeleton.Input
              active
              size="small"
              style={{ width: `${60 + i * 10}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Disconnected state
  if (!connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Text type="warning">Reconnecting...</Text>
      </div>
    );
  }

  // Empty state
  if (testFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Text type="secondary">No test files detected</Text>
      </div>
    );
  }

  // No results after filtering
  if (filteredTestFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Text type="secondary">No matching tests found</Text>
      </div>
    );
  }

  // Normal tree view
  return (
    <Tree
      blockNode
      showLine={false}
      switcherIcon={(props: { expanded?: boolean }) =>
        props.expanded ? (
          <ChevronDown size={12} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={12} strokeWidth={2.5} />
        )
      }
      showIcon
      expandAction="click"
      expandedKeys={openFiles}
      selectedKeys={activeFile ? [activeFile] : []}
      onExpand={(keys) =>
        onExpandChange(
          (keys as React.Key[]).filter(
            (key): key is string => typeof key === 'string',
          ),
        )
      }
      onSelect={(_keys, info) => {
        const key = info.node.key;
        const testPaths = filteredTestFiles.map((f) => f.testPath);
        if (typeof key === 'string' && testPaths.includes(key)) {
          onSelect(key);
        }
      }}
      treeData={treeData}
      className="m-1! bg-transparent"
    />
  );
};

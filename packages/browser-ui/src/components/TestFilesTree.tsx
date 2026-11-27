import { Skeleton, Tree } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import type { DataNode } from 'antd/es/tree';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import {
  appendSuiteSegment,
  caseKey,
  emptyKey,
  suiteKey,
  projectKey as toProjectKey,
} from '../core/treeNodeKey';
import type {
  BrowserProjectWireRow,
  TestFileInfo,
  TestSelection,
} from '../types';
import { openInEditor, toRelativePath } from '../utils';
import {
  CASE_STATUS_META,
  type CaseInfo,
  type CaseStatus,
  type FileState,
  STATUS_META,
  type TestStatus,
} from '../utils/constants';
import { TestCaseTitle } from './TestCaseTitle';
import { TestFileTitle } from './TestFileTitle';
import { TestSuiteTitle } from './TestSuiteTitle';

// ============================================================================
// Types
// ============================================================================

type SelectableNode = DataNode & { selection?: TestSelection };

type TestFilesTreeProps = {
  testFiles: TestFileInfo[];
  fileStates: Record<string, FileState>;
  caseMap: Record<string, Record<string, CaseInfo>>;
  rootPath?: string;
  projects: BrowserProjectWireRow[];
  loading: boolean;
  connected: boolean;
  openFiles: string[];
  selection: TestSelection | null;
  selectedCase?: CaseInfo;
  token: GlobalToken;
  filterText: string;
  onExpandChange: (keys: string[]) => void;
  onSelect: (selection: TestSelection) => void;
  onRerunFile: (file: string) => void;
  onRerunTestCase: (
    file: string,
    testNamePattern: string,
    caseId?: string,
  ) => void;
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

const rerunPattern = (names: string[], type: 'case' | 'suite'): string => {
  // A literal " > " selects the runner's suite-qualified name format.
  const separator = ' > ';
  const fullName = names.filter(Boolean).join(separator);
  const literal = fullName.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  return `^${literal}${type === 'suite' ? separator : '$'}`;
};

// ============================================================================
// TestFilesTree Component
// ============================================================================

export const TestFilesTree: React.FC<TestFilesTreeProps> = ({
  testFiles,
  fileStates,
  caseMap,
  rootPath,
  projects,
  loading,
  connected,
  openFiles,
  selection,
  selectedCase,
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
    (file: string, cases: CaseInfo[]): SelectableNode[] => {
      if (cases.length === 0) {
        return [
          {
            key: emptyKey(file),
            title: (
              <span className="text-xs text-(--muted-foreground)">
                No test cases reported yet
              </span>
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

        if (childStatuses.some((s) => s === 'failed')) return 'failed';
        if (childStatuses.some((s) => s === 'running')) return 'running';
        if (childStatuses.every((s) => s === 'passed')) return 'passed';
        if (childStatuses.every((s) => s === 'skipped')) return 'skipped';
        if (childStatuses.some((s) => s === 'passed')) return 'passed';
        return 'idle';
      };

      const toDataNodes = (
        node: TreeNode,
        keyPrefix: string,
      ): SelectableNode[] => {
        const result: SelectableNode[] = [];

        for (const child of node.children.values()) {
          const suiteStatus = calcStatus(child);
          const suiteMeta = CASE_STATUS_META[suiteStatus];
          const suiteKey = appendSuiteSegment(keyPrefix, child.fullPath);
          const suiteFullName = child.fullPath.join('  ');

          result.push({
            key: suiteKey,
            title: (
              <TestSuiteTitle
                icon={suiteMeta.icon}
                iconColor={suiteMeta.color}
                status={suiteStatus}
                name={child.name}
                fullName={suiteFullName}
                onRerun={
                  connected
                    ? () => {
                        onRerunTestCase(
                          file,
                          rerunPattern(child.fullPath, 'suite'),
                        );
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
            key: caseKey(keyPrefix, testCase.id),
            selection: { file, caseId: testCase.id },
            title: (
              <TestCaseTitle
                icon={caseMeta.icon}
                iconColor={caseMeta.color}
                status={testCase.status}
                label={testCase.name}
                caseId={testCase.id}
                onRerun={
                  connected
                    ? () => {
                        onRerunTestCase(
                          file,
                          rerunPattern(
                            [...testCase.parentNames, testCase.name],
                            'case',
                          ),
                          testCase.id,
                        );
                      }
                    : undefined
                }
                buttonTextColor={token.colorTextSecondary}
              />
            ),
            isLeaf: true,
          });
        }

        return result;
      };

      return toDataNodes(root, file);
    },
    [connected, onRerunTestCase, token.colorTextSecondary],
  );

  const treeData: SelectableNode[] = useMemo(() => {
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
    ): SelectableNode => {
      const filePath = fileInfo.testPath;
      const status = fileStates[filePath]?.status ?? 'idle';
      const meta = STATUS_META[status];
      // Use projectRoot if available, otherwise fall back to rootPath
      const relativePath = toRelativePath(filePath, projectRoot ?? rootPath);
      const cases = Object.values(filteredCaseMap[filePath] ?? {});

      return {
        key: filePath,
        selection: { file: filePath },
        title: (
          <TestFileTitle
            icon={meta.icon}
            iconColor={meta.color}
            status={status}
            relativePath={relativePath}
            filePath={filePath}
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
        const projectKey = toProjectKey(projectName);
        const projectRoot = projectRootMap.get(projectName);

        // Calculate project status based on file statuses
        const fileStatuses = projectFiles.map(
          (f) => fileStates[f.testPath]?.status ?? 'idle',
        );
        let projectStatus: TestStatus = 'idle';
        if (fileStatuses.some((s) => s === 'failed')) {
          projectStatus = 'failed';
        } else if (fileStatuses.some((s) => s === 'running')) {
          projectStatus = 'running';
        } else if (
          fileStatuses.length > 0 &&
          fileStatuses.every((s) => s === 'passed')
        ) {
          projectStatus = 'passed';
        }
        const projectMeta = STATUS_META[projectStatus];

        return {
          key: projectKey,
          title: (
            <div
              className="flex items-center gap-1.5"
              data-testid="test-project-title"
              data-test-project={projectName}
            >
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
    fileStates,
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
        <span className="text-(--warning)">Reconnecting...</span>
      </div>
    );
  }

  // Empty state
  if (testFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-(--muted-foreground)">
          No test files detected
        </span>
      </div>
    );
  }

  // No results after filtering
  if (filteredTestFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-(--muted-foreground)">
          No matching tests found
        </span>
      </div>
    );
  }

  const selectedKey =
    selection &&
    (selectedCase
      ? caseKey(
          suiteKey(selection.file, selectedCase.parentNames),
          selectedCase.id,
        )
      : selection.file);

  // Normal tree view
  return (
    <Tree<SelectableNode>
      blockNode
      data-testid="test-files-tree"
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
      selectedKeys={selectedKey ? [selectedKey] : []}
      onExpand={(keys) =>
        onExpandChange(
          (keys as React.Key[]).filter(
            (key): key is string => typeof key === 'string',
          ),
        )
      }
      onSelect={(_keys, info) => {
        if (info.node.selection) onSelect(info.node.selection);
      }}
      treeData={treeData}
      className="bg-transparent"
      style={{ marginLeft: '16px' }}
    />
  );
};

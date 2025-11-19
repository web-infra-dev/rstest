import { type Group, OverviewGroup } from '@rspress/core/theme';
import { useI18nUrl } from './utils';

export interface GroupItem {
  text: string;
  link: string;
}

export interface BasicGroup {
  name: string;
  items?: string[];
}

const OVERVIEW_GROUPS: BasicGroup[] = [
  {
    name: 'basic',
    items: [
      'root',
      'name',
      'include',
      'exclude',
      'setupFiles',
      'projects',
      'update',
      'globals',
      'passWithNoTests',
      'includeSource',
      'testNamePattern',
    ],
  },
  {
    name: 'runtime',
    items: [
      'env',
      'bail',
      'retry',
      'testTimeout',
      'hookTimeout',
      'maxConcurrency',
    ],
  },
  {
    name: 'mock',
    items: [
      'clearMocks',
      'resetMocks',
      'restoreMocks',
      'unstubEnvs',
      'unstubGlobals',
    ],
  },
  {
    name: 'environment',
    items: ['pool', 'isolate', 'testEnvironment'],
  },
  {
    name: 'output',
    items: [
      'coverage',
      'reporters',
      'logHeapUsage',
      'hideSkippedTests',
      'slowTestThreshold',
      'snapshotFormat',
      'chaiConfig',
      'resolveSnapshotPath',
      'onConsoleLog',
      'printConsoleTrace',
      'disableConsoleIntercept',
    ],
  },
];

function camelToKebab(str: string) {
  return str.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export default function Overview() {
  const tUrl = useI18nUrl();

  const group: Group = {
    name: '',
    items: OVERVIEW_GROUPS.map((item) => ({
      text: item.name,
      link: '',
      items: item.items?.map((item) => {
        return {
          link: tUrl(`/config/test/${camelToKebab(item)}`),
          text: item,
        };
      }),
    })),
  };

  return <OverviewGroup group={group} />;
}

const BUILD_OVERVIEW_GROUPS: BasicGroup[] = [
  {
    name: 'top level',
    items: ['plugins'],
  },
  {
    name: 'source',
    items: [
      'source.decorators',
      'source.define',
      'source.exclude',
      'source.include',
      'source.tsconfigPath',
    ],
  },
  {
    name: 'output',
    items: ['output.externals', 'output.cssModules', 'output.cleanDistPath'],
  },
  {
    name: 'resolve',
    items: [
      'resolve.aliasStrategy',
      'resolve.alias',
      'resolve.dedupe',
      'resolve.extensions',
    ],
  },
  {
    name: 'tools',
    items: ['tools.bundlerChain', 'tools.rspack', 'tools.swc'],
  },
  {
    name: 'dev',
    items: ['dev.writeToDisk'],
  },
  {
    name: 'performance',
    items: ['performance.bundleAnalyze'],
  },
];

export function BuildOverview() {
  const tUrl = useI18nUrl();

  const group: Group = {
    name: '',
    items: BUILD_OVERVIEW_GROUPS.map((groupItem) => ({
      text: groupItem.name,
      link:
        groupItem.name === 'top level'
          ? ''
          : tUrl(`/config/build/${groupItem.name}`),
      items: groupItem.items?.map((item) => {
        return {
          link:
            groupItem.name === 'top level'
              ? tUrl(`/config/build/${item}`)
              : tUrl(
                  `/config/build/${groupItem.name}#${item.replace('.', '')}`,
                ),
          text: item,
        };
      }),
    })),
  };

  return <OverviewGroup group={group} />;
}

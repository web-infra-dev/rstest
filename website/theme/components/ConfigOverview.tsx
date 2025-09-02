import { Link } from '@rspress/core/theme';
import styles from './ConfigOverview.module.scss';
import { useI18nUrl } from './utils';

export interface GroupItem {
  text: string;
  link: string;
}

export interface Group {
  name: string;
  items?: string[];
}

const OVERVIEW_GROUPS: Group[] = [
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
    items: ['retry', 'testTimeout', 'hookTimeout', 'maxConcurrency'],
  },
  {
    name: 'environment',
    items: ['pool', 'isolate', 'testEnvironment'],
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
    name: 'output',
    items: [
      'reporters',
      'slowTestThreshold',
      'onConsoleLog',
      'printConsoleTrace',
      'disableConsoleIntercept',
    ],
  },
];

export default function Overview() {
  const tUrl = useI18nUrl();
  const Nodes = OVERVIEW_GROUPS.map((group) => (
    <div key={group.name} className={styles.overviewGroups}>
      <div className={styles.group}>
        <h2>{group.name}</h2>
        <ul>
          {group.items?.map((item) => (
            <li key={item}>
              <Link href={tUrl(`/config/test/${item}`)}>{item}</Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  ));

  return <div className={styles.root}>{Nodes}</div>;
}

const BUILD_OVERVIEW_GROUPS: Group[] = [
  {
    name: 'plugins',
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
  const Nodes = BUILD_OVERVIEW_GROUPS.map((group) => (
    <div key={group.name} className={styles.overviewGroups}>
      <div className={styles.group}>
        <h2>
          <Link href={tUrl(`/config/build/${group.name}`)}> {group.name}</Link>
        </h2>
        <ul>
          {group.items?.map((item) => (
            <li key={item}>
              <Link
                href={tUrl(
                  `/config/build/${group.name}#${item.replace('.', '')}`,
                )}
              >
                {item}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  ));

  return <div className={styles.root}>{Nodes}</div>;
}

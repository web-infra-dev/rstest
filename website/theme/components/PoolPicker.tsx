import { useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme';
import { useState } from 'react';
import styles from './PoolPicker.module.scss';
import { useI18nUrl } from './utils';

type Pool = 'forks' | 'threads' | 'vmThreads' | 'vmForks';
type Verdict = 'best' | 'ok' | 'limited' | 'no';
type Lang = 'en' | 'zh';

const POOLS: Pool[] = ['forks', 'threads', 'vmThreads', 'vmForks'];
const RANK: Record<Verdict, number> = { no: 0, limited: 1, ok: 2, best: 3 };

interface Rule {
  pool: Pool;
  verdict: Verdict;
  reason: Record<Lang, string>;
}

interface Need {
  id: string;
  label: Record<Lang, string>;
  rules: Rule[];
}

const r = (pool: Pool, verdict: Verdict, zh: string, en: string): Rule => ({
  pool,
  verdict,
  reason: { zh, en },
});

// Rules follow /config/test/pool: "Choose a pool type", "threads", "VM pool behavior"
// and "pool.memoryLimit".
const NEEDS: Need[] = [
  {
    id: 'native',
    label: { zh: 'native addon', en: 'Native addons' },
    rules: [
      r(
        'forks',
        'best',
        '进程隔离，兼容性最好',
        'Process isolation, broadest compatibility',
      ),
      r(
        'threads',
        'limited',
        'addon 需支持 worker thread，崩溃会影响整个进程',
        'Addons must support worker threads; a crash takes down the whole process',
      ),
      r(
        'vmThreads',
        'limited',
        'addon 需支持 worker thread，崩溃会影响整个进程',
        'Addons must support worker threads; a crash takes down the whole process',
      ),
      r(
        'vmForks',
        'limited',
        'addon 状态不在 VM 隔离范围内',
        'Addon state lives outside VM isolation',
      ),
    ],
  },
  {
    id: 'process',
    label: {
      zh: 'process.chdir() / 进程信号',
      en: 'process.chdir() / signals',
    },
    rules: [
      r('forks', 'best', '保留完整进程 API', 'Full process API'),
      r(
        'threads',
        'no',
        'worker thread 不支持 process.chdir() 与进程信号',
        'Worker threads lack process.chdir() and OS signals',
      ),
      r(
        'vmThreads',
        'no',
        'worker thread 不支持 process.chdir() 与进程信号',
        'Worker threads lack process.chdir() and OS signals',
      ),
      r('vmForks', 'best', '保留完整进程 API', 'Full process API'),
    ],
  },
  {
    id: 'dom',
    label: {
      zh: '大量 jsdom / happy-dom 文件',
      en: 'Many jsdom / happy-dom files',
    },
    rules: [
      r(
        'forks',
        'limited',
        '每个文件重新启动进程并加载环境，总耗时最长',
        'Starts a process and loads the environment per file, the slowest option',
      ),
      r(
        'threads',
        'ok',
        '仍逐文件加载环境',
        'Still loads the environment per file',
      ),
      r(
        'vmThreads',
        'best',
        '复用 worker 与编译结果，性能最佳',
        'Reuses workers and compilation results, the fastest option',
      ),
      r(
        'vmForks',
        'best',
        '复用 worker，同时保留进程能力',
        'Reuses workers while keeping process capabilities',
      ),
    ],
  },
  {
    id: 'short',
    label: { zh: '大量执行很短的文件', en: 'Many short files' },
    rules: [
      r(
        'forks',
        'limited',
        '每个文件都要启动新进程',
        'Starts a new process per file',
      ),
      r(
        'threads',
        'best',
        'worker thread 启动更快',
        'Worker threads start faster',
      ),
      r(
        'vmThreads',
        'best',
        '复用 worker，省去重复启动',
        'Reuses workers, no repeated startup',
      ),
      r(
        'vmForks',
        'ok',
        '复用进程，但进程开销高于线程',
        'Reuses processes, which cost more than threads',
      ),
    ],
  },
  {
    id: 'memory',
    label: { zh: '限制单个 worker 内存', en: 'Per-worker memory limit' },
    rules: [
      r(
        'forks',
        'limited',
        'memoryLimit 仅在 isolate: false 时生效',
        'memoryLimit only applies with isolate: false',
      ),
      r('threads', 'no', '忽略 memoryLimit', 'Ignores memoryLimit'),
      r(
        'vmThreads',
        'best',
        '默认按「系统内存 / maxWorkers」回收 worker',
        'Recycles workers at system memory / maxWorkers by default',
      ),
      r(
        'vmForks',
        'best',
        '支持 memoryLimit，并按子进程 RSS 调度',
        'Supports memoryLimit and schedules by child-process RSS',
      ),
    ],
  },
  {
    id: 'loader',
    label: {
      zh: '自定义 Node.js loader / 外部 TS',
      en: 'Custom Node.js loader / external TS',
    },
    rules: [
      r(
        'forks',
        'ok',
        '使用 Node.js 原生 loader',
        'Uses the native Node.js loader',
      ),
      r(
        'threads',
        'ok',
        '使用 Node.js 原生 loader',
        'Uses the native Node.js loader',
      ),
      r(
        'vmThreads',
        'no',
        'VM 不支持自定义 loader 与外部 TS 执行',
        'VM does not support custom loaders or external TS execution',
      ),
      r(
        'vmForks',
        'no',
        'VM 不支持自定义 loader 与外部 TS 执行',
        'VM does not support custom loaders or external TS execution',
      ),
    ],
  },
  {
    id: 'noIsolate',
    label: {
      zh: 'isolate: false 复用模块缓存',
      en: 'isolate: false module cache reuse',
    },
    rules: [
      r(
        'forks',
        'best',
        '关闭 isolate 后可复用模块缓存',
        'Reuses the module cache with isolate off',
      ),
      r(
        'threads',
        'best',
        '关闭 isolate 后可复用模块缓存',
        'Reuses the module cache with isolate off',
      ),
      r(
        'vmThreads',
        'no',
        'VM pool 始终按文件隔离，isolate 无效',
        'VM pools always isolate per file; isolate has no effect',
      ),
      r(
        'vmForks',
        'no',
        'VM pool 始终按文件隔离，isolate 无效',
        'VM pools always isolate per file; isolate has no effect',
      ),
    ],
  },
  {
    id: 'realm',
    label: { zh: '断言依赖 instanceof', en: 'instanceof assertions' },
    rules: [
      r('forks', 'ok', '单一 realm', 'Single realm'),
      r('threads', 'ok', '单一 realm', 'Single realm'),
      r(
        'vmThreads',
        'limited',
        '跨 realm 的 instanceof 可能失败',
        'Cross-realm instanceof checks can fail',
      ),
      r(
        'vmForks',
        'limited',
        '跨 realm 的 instanceof 可能失败',
        'Cross-realm instanceof checks can fail',
      ),
    ],
  },
];

const TEXT: Record<
  Lang,
  {
    title: string;
    hint: string;
    empty: string;
    verdict: Record<Verdict, string>;
  }
> = {
  en: {
    title: 'What does your test suite need?',
    hint: 'Pick any that apply. Each pool is rated against the selection.',
    empty: 'The default; start here',
    verdict: {
      best: 'Recommended',
      ok: 'Works',
      limited: 'Limited',
      no: 'Not suitable',
    },
  },
  zh: {
    title: '你的测试套件需要什么？',
    hint: '可多选，下面按所选条件给出每种 pool 的适配情况。',
    empty: '默认选择，从这里开始',
    verdict: { best: '推荐', ok: '可用', limited: '受限', no: '不适用' },
  },
};

interface Rated {
  pool: Pool;
  verdict: Verdict;
  reasons: string[];
}

function rate(selected: Set<string>, lang: Lang): Rated[] {
  const rules = NEEDS.filter((n) => selected.has(n.id)).flatMap((n) => n.rules);
  const rated = POOLS.map<Rated>((pool) => {
    const own = rules.filter((rule) => rule.pool === pool);
    if (own.length === 0) {
      return {
        pool,
        verdict: pool === 'forks' ? 'best' : 'ok',
        reasons: pool === 'forks' ? [TEXT[lang].empty] : [],
      };
    }
    const worst = own.reduce(
      (acc, rule) => (RANK[rule.verdict] < RANK[acc] ? rule.verdict : acc),
      'best' as Verdict,
    );
    const verdict: Verdict =
      RANK[worst] >= RANK.ok
        ? own.some((rule) => rule.verdict === 'best')
          ? 'best'
          : 'ok'
        : worst;
    // Blocking reasons first, then the upsides, so a "limited" row still says
    // what the pool is good at.
    const reasons = [
      ...new Set(
        [...own]
          .sort((a, b) => RANK[a.verdict] - RANK[b.verdict])
          .map((rule) => rule.reason[lang]),
      ),
    ];
    return { pool, verdict, reasons };
  });
  // Always recommend something: when no pool is a clean fit, the best
  // remaining option(s) become the recommendation.
  const top = Math.max(...rated.map((item) => RANK[item.verdict]));
  if (top < RANK.best && top > RANK.no) {
    for (const item of rated) {
      if (RANK[item.verdict] === top) {
        item.verdict = 'best';
      }
    }
  }
  return rated.sort((a, b) => RANK[b.verdict] - RANK[a.verdict]);
}

export function PoolPicker() {
  const lang: Lang = useLang() === 'zh' ? 'zh' : 'en';
  const text = TEXT[lang];
  const toUrl = useI18nUrl();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={styles.root}>
      <p className={styles.title}>{text.title}</p>
      <p className={styles.hint}>{text.hint}</p>
      <div className={styles.options}>
        {NEEDS.map((need) => {
          const active = selected.has(need.id);
          return (
            <button
              key={need.id}
              type="button"
              aria-pressed={active}
              className={active ? styles.optionActive : styles.option}
              onClick={() => toggle(need.id)}
            >
              {need.label[lang]}
            </button>
          );
        })}
      </div>
      <ul className={styles.results}>
        {rate(selected, lang).map(({ pool, verdict, reasons }) => (
          <li key={pool} className={styles.result} data-verdict={verdict}>
            <Link
              className={styles.pool}
              href={toUrl(`/config/test/pool#${pool.toLowerCase()}`)}
            >
              {pool}
            </Link>
            <span className={styles.verdict}>{text.verdict[verdict]}</span>
            <span className={styles.reasons}>
              {reasons.join(lang === 'zh' ? '；' : '; ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

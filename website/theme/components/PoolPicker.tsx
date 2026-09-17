import { useLang } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme';
import { useState } from 'react';
import styles from './PoolPicker.module.scss';
import { useUrl } from './utils';

type Pool = 'forks' | 'threads' | 'vmThreads' | 'vmForks';
type Need = 'process' | 'dom' | 'light' | 'memory';

const NEEDS: Need[] = ['process', 'dom', 'light', 'memory'];

const TEXT = {
  en: {
    title: 'Which pool fits your project?',
    hint: 'Tick what applies to your test suite.',
    needs: {
      process:
        'Tests need native addons, process.chdir(), or other process-level APIs',
      dom: 'Many test files load jsdom or happy-dom',
      light: 'Many test files, each one finishes quickly',
      memory: 'Memory of a single worker must be capped',
    },
    recommended: 'Recommended',
    pools: {
      forks: {
        why: 'The default and the most compatible choice.',
        caveat: 'High startup cost for large DOM test suites.',
      },
      threads: {
        why: 'Worker threads start faster than processes, which pays off when files are many and light.',
        caveat: 'Some process-level capabilities are unavailable.',
      },
      vmThreads: {
        why: 'Reuses workers across files, the fastest option for jsdom / happy-dom suites.',
        caveat: 'Cross-realm and custom loader limitations.',
      },
      vmForks: {
        why: 'VM pool speed plus process-level capabilities and per-worker memory control.',
        caveat: 'Process-level state must not leak between files.',
      },
    },
  },
  zh: {
    title: '你的项目适合哪种 pool？',
    hint: '勾选符合你测试套件的情况。',
    needs: {
      process: '测试依赖 native addon、process.chdir() 等进程级能力',
      dom: '大量测试文件加载 jsdom / happy-dom',
      light: '测试文件多，但单个文件执行很短',
      memory: '需要限制单个 worker 的内存占用',
    },
    recommended: '推荐',
    pools: {
      forks: {
        why: '默认选择，兼容性最好。',
        caveat: '大型 DOM 测试套件启动开销较高。',
      },
      threads: {
        why: 'worker thread 比进程启动更快，文件多且执行较轻时收益明显。',
        caveat: '不支持部分进程级能力。',
      },
      vmThreads: {
        why: '跨文件复用 worker，jsdom / happy-dom 测试套件的最快选项。',
        caveat: '存在跨 realm 与自定义 loader 限制。',
      },
      vmForks: {
        why: '兼顾 VM pool 性能、进程级能力与单 worker 内存控制。',
        caveat: '需避免进程级状态残留。',
      },
    },
  },
};

function pickPool(needs: Set<Need>): Pool {
  const reuseWorker = needs.has('dom') || needs.has('memory');
  if (needs.has('process')) {
    return reuseWorker ? 'vmForks' : 'forks';
  }
  if (needs.has('dom')) {
    return 'vmThreads';
  }
  if (needs.has('memory')) {
    return 'vmForks';
  }
  if (needs.has('light')) {
    return 'threads';
  }
  return 'forks';
}

export function PoolPicker() {
  const lang = useLang();
  const text = lang === 'zh' ? TEXT.zh : TEXT.en;
  const [needs, setNeeds] = useState<Set<Need>>(() => new Set());
  const pool = pickPool(needs);
  const docUrl = useUrl(`/config/test/pool#${pool.toLowerCase()}`);

  const toggle = (need: Need) => {
    setNeeds((prev) => {
      const next = new Set(prev);
      if (next.has(need)) {
        next.delete(need);
      } else {
        next.add(need);
      }
      return next;
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.needs}>
        <p className={styles.title}>{text.title}</p>
        <p className={styles.hint}>{text.hint}</p>
        <div className={styles.options}>
          {NEEDS.map((need) => {
            const active = needs.has(need);
            return (
              <button
                key={need}
                type="button"
                aria-pressed={active}
                className={active ? styles.optionActive : styles.option}
                onClick={() => toggle(need)}
              >
                {text.needs[need]}
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.result}>
        <p className={styles.recommended}>{text.recommended}</p>
        <p key={pool} className={styles.pool}>
          <Link href={docUrl}>{pool}</Link>
        </p>
        <p className={styles.why}>{text.pools[pool].why}</p>
        <p className={styles.caveat}>{text.pools[pool].caveat}</p>
        <p className={styles.snippet}>{`pool: { type: '${pool}' }`}</p>
      </div>
    </div>
  );
}

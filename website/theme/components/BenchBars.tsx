import { useEffect, useRef, useState } from 'react';
import styles from './BenchBars.module.scss';

export interface BenchBar {
  label: string;
  /** Duration in seconds. */
  value: number;
  /** Paint the bar with the brand gradient and show `note` next to the value. */
  highlight?: boolean;
  note?: string;
}

export interface BenchGroup {
  label?: string;
  bars: BenchBar[];
}

/**
 * Horizontal bar chart for timing comparisons. All bars share one scale so
 * groups stay comparable. Bars grow from zero once the chart scrolls into view.
 */
export function BenchBars({ groups }: { groups: BenchGroup[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(...groups.flatMap((g) => g.bars.map((b) => b.value)));
  let index = 0;

  return (
    <div ref={rootRef} className={styles.root}>
      {groups.map((group) => (
        <div key={group.label ?? 'group'} className={styles.group}>
          {group.label && <p className={styles.groupLabel}>{group.label}</p>}
          {group.bars.map((bar) => {
            const delay = `${index++ * 120}ms`;
            const width = inView ? `${(bar.value / max) * 100}%` : '0%';
            return (
              <div key={bar.label} className={styles.row}>
                <span className={styles.label}>
                  {bar.label}
                  {bar.note && <em className={styles.note}>{bar.note}</em>}
                </span>
                <span className={styles.track}>
                  <span
                    className={
                      bar.highlight ? styles.fillHighlight : styles.fill
                    }
                    style={{ width, transitionDelay: delay }}
                  />
                </span>
                <span
                  className={inView ? styles.valueVisible : styles.value}
                  style={{ transitionDelay: delay }}
                >
                  {bar.value.toFixed(2)}s
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

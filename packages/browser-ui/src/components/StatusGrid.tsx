import { Tag } from 'antd';
import React, { memo } from 'react';

/* cspell:ignore nums */
export type StatusCounts = {
  idle: number;
  running: number;
  passed: number;
  failed: number;
  skipped: number;
};

/**
 * Status indicator with Vercel-inspired design.
 */
export const StatusGrid: React.FC<{
  counts: StatusCounts;
  isRunning: boolean;
}> = memo(({ counts, isRunning }) => {
  const items = [
    { key: 'passed', label: 'passed', color: 'green' },
    { key: 'failed', label: 'failed', color: 'red' },
    { key: 'running', label: 'running', color: 'amber' },
  ] as const;

  // If some files are running but no test cases have reported yet
  const isFileLoading = isRunning && counts.running === 0;

  return (
    <div className="flex h-6 cursor-default select-none items-center">
      <div className="flex items-center gap-1.5">
        {items.map((item) => {
          const count = counts[item.key];
          const isRunningItem = item.key === 'running';

          return (
            <Tag
              key={item.label}
              className={`m-0 flex items-center gap-1 px-2 py-0 border-0 ${isRunningItem && isFileLoading ? 'animate-pulse' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: `var(--ds-${item.color}-200)`,
                color: `var(--ds-${item.color}-900)`,
                borderRadius: '100px',
                fontSize: '11px',
                height: '20px',
                lineHeight: 'normal',
                fontWeight: 700,
              }}
            >
              <span
                className="font-mono"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 'inherit',
                }}
              >
                {count}
              </span>
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ fontWeight: 'inherit' }}
              >
                {item.label}
              </span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
});

import { Tag } from 'antd';
import React, { memo } from 'react';

export type StatusCounts = Record<string, number>;

/**
 * Status indicator with Vercel-inspired design.
 */
export const StatusGrid: React.FC<{
  counts: StatusCounts;
  isRunning: boolean;
}> = memo(({ counts, isRunning }) => {
  const items = [
    { key: 'pass', label: 'passed', color: 'green' },
    { key: 'fail', label: 'failed', color: 'red' },
    { key: 'running', label: 'running', color: 'amber' },
  ];

  // If some files are running but no test cases have reported yet
  const isFileLoading = isRunning && counts.running === 0;

  return (
    <div className="flex h-6 cursor-default select-none items-center">
      <div className="flex items-center gap-1.5">
        {items.map((item) => {
          const count = counts[item.key as keyof StatusCounts] || 0;
          const isRunningItem = item.key === 'running';

          return (
            <Tag
              key={item.label}
              className={`m-0! flex items-center px-2 py-0! border-0! ${isRunningItem && isFileLoading ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: `var(--ds-${item.color}-200)`,
                color: `var(--ds-${item.color}-900)`,
                borderRadius: '100px',
                fontSize: '11px',
                height: '20px',
                lineHeight: '20px',
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
              </span>{' '}
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

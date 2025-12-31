import { Tooltip } from 'antd';
import React from 'react';
import type { CaseStatus } from '../utils/constants';
import { CASE_STATUS_META } from '../utils/constants';

export type StatusCounts = Record<CaseStatus, number>;

/**
 * Single grid bar - flat design without glow effect.
 */
const GridBar: React.FC<{
  color: string;
  isEmpty?: boolean;
}> = ({ color, isEmpty }) => {
  return (
    <div
      className="transition-all duration-150"
      style={{
        width: 3,
        height: 11,
        backgroundColor: isEmpty ? 'currentColor' : color,
        opacity: isEmpty ? 0.08 : 1,
        borderRadius: 1.5,
      }}
    />
  );
};

/**
 * Status indicator grid with Vercel-inspired design.
 * Shows test case distribution with dynamic grid sizing.
 */
export const StatusGrid: React.FC<{ counts: StatusCounts }> = ({ counts }) => {
  const total =
    counts.idle + counts.running + counts.pass + counts.fail + counts.skip;

  // Dynamic grid count based on total cases (min 4, max 6)
  const gridCount =
    total === 0 ? 4 : Math.min(6, Math.max(4, Math.ceil(total / 5)));

  // Build grid configuration
  type GridItem = {
    color: string;
    status: string;
    isEmpty?: boolean;
  };
  const gridConfig: GridItem[] = [];

  if (total === 0) {
    // Empty state - show placeholder bars
    for (let i = 0; i < gridCount; i++) {
      gridConfig.push({
        color: CASE_STATUS_META.idle.color,
        status: 'empty',
        isEmpty: true,
      });
    }
  } else {
    // Calculate proportional grid for each status
    // Priority order: pass -> fail -> running -> skip -> idle
    const statuses: CaseStatus[] = ['pass', 'fail', 'running', 'skip', 'idle'];

    const baseGridCounts: Record<CaseStatus, number> = {
      pass: 0,
      fail: 0,
      running: 0,
      skip: 0,
      idle: 0,
    };

    // First pass: floor values
    for (const status of statuses) {
      baseGridCounts[status] = Math.floor((counts[status] / total) * gridCount);
    }

    // Calculate remaining
    let remaining =
      gridCount - Object.values(baseGridCounts).reduce((a, b) => a + b, 0);

    // Distribute remaining based on fractional parts
    const fractions = statuses
      .filter((s) => counts[s] > 0)
      .map((s) => ({
        status: s,
        fraction: ((counts[s] / total) * gridCount) % 1,
      }))
      .sort((a, b) => b.fraction - a.fraction);

    for (const { status } of fractions) {
      if (remaining <= 0) break;
      baseGridCounts[status]++;
      remaining--;
    }

    // Ensure at least 1 bar for any status with count > 0
    for (const status of statuses) {
      if (counts[status] > 0 && baseGridCounts[status] === 0) {
        const largest = statuses
          .filter((s) => baseGridCounts[s] > 1)
          .sort((a, b) => baseGridCounts[b] - baseGridCounts[a])[0];
        if (largest) {
          baseGridCounts[largest]--;
          baseGridCounts[status]++;
        }
      }
    }

    // Build grid array (flat, no glow)
    for (const status of statuses) {
      const meta = CASE_STATUS_META[status];
      for (let i = 0; i < baseGridCounts[status]; i++) {
        gridConfig.push({
          color: meta.color,
          status,
        });
      }
    }
  }

  // Tooltip content
  const tooltipLines = [
    counts.pass > 0 ? `${counts.pass} passed` : null,
    counts.fail > 0 ? `${counts.fail} failed` : null,
    counts.running > 0 ? `${counts.running} running` : null,
    counts.skip > 0 ? `${counts.skip} skipped` : null,
    counts.idle > 0 ? `${counts.idle} pending` : null,
  ].filter(Boolean);

  const tooltipText = total === 0 ? 'No tests' : tooltipLines.join(' · ');

  // Primary color based on status priority
  const primaryColor =
    counts.fail > 0
      ? CASE_STATUS_META.fail.color
      : counts.running > 0
        ? CASE_STATUS_META.running.color
        : counts.pass > 0
          ? CASE_STATUS_META.pass.color
          : CASE_STATUS_META.idle.color;

  return (
    <Tooltip title={tooltipText} mouseLeaveDelay={0}>
      <div className="flex h-5 cursor-default select-none items-center gap-2">
        {/* Grid bars */}
        <div className="flex items-center gap-[2px]">
          {gridConfig.map((config, i) => (
            <GridBar
              key={`${config.status}-${i}`}
              color={config.color}
              isEmpty={config.isEmpty}
            />
          ))}
        </div>

        {/* Count display */}
        {total > 0 && (
          <div className="flex items-center gap-0.5 font-mono text-xs leading-none tracking-tight">
            <span
              style={{
                color: primaryColor,
                fontWeight: 600,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {counts.pass}
            </span>
            <span style={{ opacity: 0.2 }}>/</span>
            <span
              style={{
                opacity: 0.45,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {total}
            </span>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

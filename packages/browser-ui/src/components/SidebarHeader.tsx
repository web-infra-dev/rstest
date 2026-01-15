import { Button, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Moon, Sun, SunMoon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import Logo from '../rstest-logo.svg?react';
import type { StatusCounts } from './StatusGrid';

const CONNECTED_COLOR = 'var(--ds-green-700)';
const DISCONNECTED_COLOR = 'var(--accents-4)';

type ThemeMode = 'dark' | 'light' | 'system';

type SidebarHeaderProps = {
  theme: ThemeMode;
  onThemeToggle: (theme: ThemeMode) => void;
  isConnected: boolean;
  token: GlobalToken;
  counts: StatusCounts;
};

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  theme,
  onThemeToggle,
  isConnected,
  token,
  counts,
}) => {
  const [flashKey, setFlashKey] = useState(0);
  const prevCountsRef = useRef(counts);

  useEffect(() => {
    // Trigger flash if counts change (specifically pass, fail, or running)
    const prev = prevCountsRef.current;
    if (
      prev.pass !== counts.pass ||
      prev.fail !== counts.fail ||
      prev.running !== counts.running
    ) {
      // Debounce the flash key update to avoid hectic animations
      const timer = setTimeout(() => {
        setFlashKey((k) => k + 1);
      }, 100);
      return () => clearTimeout(timer);
    }
    prevCountsRef.current = counts;
  }, [counts]);

  const total =
    counts.idle + counts.running + counts.pass + counts.fail + counts.skip;

  const getPercent = (count: number) =>
    total === 0 ? 0 : (count / total) * 100;

  const passPercent = getPercent(counts.pass);
  const failPercent = getPercent(counts.fail);
  const runningPercent = getPercent(counts.running);

  const handleCycleTheme = () => {
    if (theme === 'system') onThemeToggle('light');
    else if (theme === 'light') onThemeToggle('dark');
    else onThemeToggle('system');
  };

  const ThemeIcon = {
    system: SunMoon,
    light: Sun,
    dark: Moon,
  }[theme];

  const themeLabels = {
    system: 'Theme: System',
    light: 'Theme: Light',
    dark: 'Theme: Dark',
  };

  return (
    <div
      className="relative flex h-[48px] items-center justify-between px-4"
      style={{ background: token.colorBgContainer }}
    >
      <div className="flex items-center gap-2">
        <Logo className="h-6 transition-all" />
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-bold tracking-tight">Rstest</span>
          <span className="font-mono text-[9px] opacity-40 uppercase tracking-widest">
            Browser
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Tooltip
          title={isConnected ? 'Connected' : 'Connecting...'}
          mouseLeaveDelay={0}
        >
          <span
            className="inline-flex h-2 w-2 cursor-default rounded-full"
            style={{
              backgroundColor: isConnected
                ? CONNECTED_COLOR
                : DISCONNECTED_COLOR,
            }}
          />
        </Tooltip>
        <Tooltip title={themeLabels[theme]} mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            className="flex h-8 w-8 items-center justify-center rounded-md p-0!"
            icon={<ThemeIcon size={14} strokeWidth={2.5} />}
            onClick={handleCycleTheme}
          />
        </Tooltip>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-[1px] overflow-hidden"
        style={{ background: 'var(--accents-2)' }}
      >
        <div
          key={`pass-${flashKey}`}
          className={`absolute inset-y-0 left-0 h-full transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${flashKey > 0 ? 'progress-flash-active' : ''}`}
          style={{
            width: `${passPercent}%`,
            background: 'var(--ds-green-700)',
            zIndex: 3,
            color: 'var(--ds-green-700)',
          }}
        />
        <div
          key={`fail-${flashKey}`}
          className={`absolute inset-y-0 left-0 h-full transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${flashKey > 0 ? 'progress-flash-active' : ''}`}
          style={{
            width: `${passPercent + failPercent}%`,
            background: 'var(--ds-red-800)',
            zIndex: 2,
            color: 'var(--ds-red-800)',
          }}
        />
        <div
          key={`run-${flashKey}`}
          className={`absolute inset-y-0 left-0 h-full transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${flashKey > 0 ? 'progress-flash-active' : ''}`}
          style={{
            width: `${passPercent + failPercent + runningPercent}%`,
            background: 'var(--ds-amber-700)',
            zIndex: 1,
            color: 'var(--ds-amber-700)',
          }}
        />
      </div>
    </div>
  );
};

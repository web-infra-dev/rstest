import { Avatar, Button, Progress, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import React from 'react';

type SidebarHeaderProps = {
  themeSwitchLabel: string;
  isDark: boolean;
  onThemeToggle: (checked: boolean) => void;
  onRerun: () => void;
  canUseRpc: boolean;
  token: GlobalToken;
  progressPercent: number;
  successPercent: number;
};

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  themeSwitchLabel,
  isDark,
  onThemeToggle,
  onRerun,
  canUseRpc,
  token,
  progressPercent,
  successPercent,
}) => {
  return (
    <div
      className="relative flex h-[52px] items-center justify-between px-3"
      style={{ background: token.colorBgContainer }}
    >
      <div className="flex items-center gap-3">
        <Avatar
          src="https://assets.rspack.rs/rstest/rstest-logo-512x512.png"
          size={32}
          shape="square"
        />
        <span className="text-base font-semibold leading-tight text-[color:var(--ant-color-text)]">
          Browser Tests
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip title={themeSwitchLabel} mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            shape="circle"
            icon={isDark ? <Sun size={14} /> : <Moon size={14} />}
            onClick={() => onThemeToggle(!isDark)}
          />
        </Tooltip>
        <Tooltip title="Re-run active file" mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            shape="circle"
            onClick={onRerun}
            disabled={!canUseRpc}
            icon={<RefreshCw size={14} />}
          />
        </Tooltip>
      </div>
      <Progress
        percent={progressPercent}
        success={{ percent: successPercent }}
        showInfo={false}
        strokeWidth={2}
        size="small"
        strokeLinecap="square"
        strokeColor="#f87171"
        className="absolute! inset-x-0 bottom-0 m-0! translate-y-[calc(50%-2px)]"
      />
    </div>
  );
};

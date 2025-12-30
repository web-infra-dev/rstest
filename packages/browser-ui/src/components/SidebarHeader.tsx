import { Button, Progress, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Moon, Sun } from 'lucide-react';
import React from 'react';
import Logo from '../rstest-logo.svg?react';
import { STATUS_META } from '../utils/constants';

const CONNECTED_COLOR = STATUS_META.pass.color;
const DISCONNECTED_COLOR = '#9ca3af';

type SidebarHeaderProps = {
  themeSwitchLabel: string;
  isDark: boolean;
  onThemeToggle: (checked: boolean) => void;
  isConnected: boolean;
  token: GlobalToken;
  progressPercent: number;
  successPercent: number;
};

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  themeSwitchLabel,
  isDark,
  onThemeToggle,
  isConnected,
  token,
  progressPercent,
  successPercent,
}) => {
  return (
    <div
      className="relative flex h-[52px] items-center justify-between px-3"
      style={{ background: token.colorBgContainer }}
    >
      <Logo className="h-7" />
      <div className="flex items-center gap-2">
        <Tooltip
          title={isConnected ? 'Connected' : 'Connecting...'}
          mouseLeaveDelay={0}
        >
          <span
            className="inline-flex h-1.5 w-1.5 cursor-default rounded-full"
            style={{
              backgroundColor: isConnected
                ? CONNECTED_COLOR
                : DISCONNECTED_COLOR,
              boxShadow: isConnected
                ? `0 0 4px 1px ${CONNECTED_COLOR}80`
                : undefined,
            }}
          />
        </Tooltip>
        <Tooltip title={themeSwitchLabel} mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            shape="circle"
            icon={isDark ? <Sun size={14} /> : <Moon size={14} />}
            onClick={() => onThemeToggle(!isDark)}
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

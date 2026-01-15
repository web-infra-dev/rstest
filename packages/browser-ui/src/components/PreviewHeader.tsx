import { Typography } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Play } from 'lucide-react';
import React from 'react';
import { STATUS_META, type TestStatus } from '../utils/constants';

type PreviewHeaderProps = {
  token: GlobalToken;
  activeDisplayName: string;
  status?: TestStatus;
};

const { Text } = Typography;

export const PreviewHeader: React.FC<PreviewHeaderProps> = ({
  token,
  activeDisplayName,
  status,
}) => {
  const meta = status ? STATUS_META[status] : undefined;

  // Map internal status to Geist scale name
  const colorKey =
    status === 'pass'
      ? 'green'
      : status === 'fail'
        ? 'red'
        : status === 'running'
          ? 'amber'
          : null;

  return (
    <div
      className="flex h-[48px] items-center justify-between px-4"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorder}`,
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-6 w-6 items-center justify-center bg-black dark:bg-white"
          style={{
            borderRadius: 4,
          }}
        >
          <Play size={12} fill={token.colorBgContainer} strokeWidth={2.5} />
        </div>
        <div className="flex items-center gap-2">
          <Text
            type="secondary"
            className="font-mono text-[10px]! font-medium tracking-tighter opacity-70"
          >
            PREVIEW
          </Text>
          <span
            className="h-3 w-[1px]"
            style={{ background: 'var(--border)' }}
          />
          <Text strong className="text-[13px]! tracking-tight">
            {activeDisplayName}
          </Text>
        </div>
      </div>

      {meta && colorKey && (
        <div
          className="flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider"
          style={{
            backgroundColor: `var(--ds-${colorKey}-200)`,
            color: `var(--ds-${colorKey}-900)`,
            fontWeight: 700,
          }}
        >
          {meta.label.toUpperCase()}
        </div>
      )}
    </div>
  );
};

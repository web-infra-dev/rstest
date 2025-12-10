import { Typography } from 'antd';
import { CheckCircle2, XCircle } from 'lucide-react';
import React from 'react';

type StatsBarProps = {
  passCount: number;
  failCount: number;
  borderColor: string;
  background: string;
};

const { Text } = Typography;

export const StatsBar: React.FC<StatsBarProps> = ({
  passCount,
  failCount,
  borderColor,
  background,
}) => {
  return (
    <div
      className="flex flex-col px-3 py-2"
      style={{
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        background,
      }}
    >
      <div className="flex gap-4 text-xs">
        <div className="inline-flex items-center gap-2">
          <CheckCircle2 size={14} className="shrink-0 text-[#4ade80]" />
          <Text className="leading-none!">{passCount} passed</Text>
        </div>
        <div className="inline-flex items-center gap-2">
          <XCircle size={14} className="shrink-0 text-[#f87171]" />
          <Text className="leading-none!">{failCount} failed</Text>
        </div>
      </div>
    </div>
  );
};

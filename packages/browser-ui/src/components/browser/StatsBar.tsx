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
      className="flex flex-col"
      style={{
        borderTop: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        background,
        padding: '8px 12px',
      }}
    >
      <div className="flex gap-4 text-[12px]">
        <div className="inline-flex items-center gap-2 leading-none">
          <span className="inline-flex items-center justify-center">
            <CheckCircle2 size={14} color="#4ade80" className="shrink-0" />
          </span>
          <Text className="leading-none" style={{ lineHeight: 1 }}>
            {passCount} passed
          </Text>
        </div>
        <div className="inline-flex items-center gap-2 leading-none">
          <span className="inline-flex items-center justify-center">
            <XCircle size={14} color="#f87171" className="shrink-0" />
          </span>
          <Text className="leading-none" style={{ lineHeight: 1 }}>
            {failCount} failed
          </Text>
        </div>
      </div>
    </div>
  );
};

import { Tag, Typography } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Play } from 'lucide-react';
import React from 'react';

type PreviewHeaderProps = {
  token: GlobalToken;
  activeDisplayName: string;
  statusLabel?: string;
  statusColor?: string;
};

const { Text } = Typography;

export const PreviewHeader: React.FC<PreviewHeaderProps> = ({
  token,
  activeDisplayName,
  statusLabel,
  statusColor,
}) => {
  return (
    <div
      className="flex h-[52px] items-center justify-between px-4"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center"
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: token.borderRadiusSM,
          }}
        >
          <Play size={14} fill={token.colorText} />
        </div>
        <div className="flex flex-col">
          <Text type="secondary" className="text-[10px]! tracking-wide" strong>
            PREVIEW
          </Text>
          <Text strong className="text-[13px]!">
            {activeDisplayName}
          </Text>
        </div>
      </div>

      {statusLabel && statusColor && (
        <Tag
          bordered={false}
          color={statusColor}
          className="mr-0! font-semibold! text-black!"
        >
          {statusLabel.toUpperCase()}
        </Tag>
      )}
    </div>
  );
};

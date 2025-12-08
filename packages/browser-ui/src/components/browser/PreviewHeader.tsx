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
          className="flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: token.borderRadiusSM,
          }}
        >
          <Play size={14} fill={token.colorText} />
        </div>
        <div className="flex flex-col gap-0">
          <Text
            type="secondary"
            style={{ fontSize: 10, letterSpacing: '0.05em' }}
            strong
          >
            PREVIEW
          </Text>
          <Text strong style={{ fontSize: 13 }}>
            {activeDisplayName}
          </Text>
        </div>
      </div>

      {statusLabel && statusColor && (
        <Tag
          bordered={false}
          color={statusColor}
          style={{
            color: '#000',
            fontWeight: 600,
            marginRight: 0,
          }}
        >
          {statusLabel.toUpperCase()}
        </Tag>
      )}
    </div>
  );
};

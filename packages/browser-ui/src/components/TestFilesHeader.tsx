import { Badge, Typography } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import React from 'react';

type TestFilesHeaderProps = {
  isConnected: boolean;
  token: GlobalToken;
};

const { Text } = Typography;

export const TestFilesHeader: React.FC<TestFilesHeaderProps> = ({
  isConnected,
  token,
}) => {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
    >
      <Text type="secondary" className="text-[11px]! tracking-wide" strong>
        TEST FILES
      </Text>
      <Badge
        status={isConnected ? 'success' : 'default'}
        text={isConnected ? 'Connected' : 'Connecting...'}
        styles={{
          root: { color: token.colorTextSecondary, fontSize: 12 },
        }}
      />
    </div>
  );
};

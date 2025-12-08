import { Badge, Typography } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import React from 'react';

type TestFilesHeaderProps = {
  canUseRpc: boolean;
  token: GlobalToken;
};

const { Text } = Typography;

export const TestFilesHeader: React.FC<TestFilesHeaderProps> = ({
  canUseRpc,
  token,
}) => {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Text
        type="secondary"
        style={{ fontSize: 11, letterSpacing: '0.05em' }}
        strong
      >
        TEST FILES
      </Text>
      <Badge
        status={canUseRpc ? 'success' : 'default'}
        text={canUseRpc ? 'Live' : 'Static'}
        styles={{
          root: { color: token.colorTextSecondary, fontSize: 12 },
        }}
      />
    </div>
  );
};

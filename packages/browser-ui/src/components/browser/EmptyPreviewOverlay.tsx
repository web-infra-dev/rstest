import { Typography } from 'antd';
import React from 'react';

const { Text } = Typography;

type EmptyPreviewOverlayProps = {
  message: string;
};

export const EmptyPreviewOverlay: React.FC<EmptyPreviewOverlayProps> = ({
  message,
}) => {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.02)' }}
    >
      <Text type="secondary">{message}</Text>
    </div>
  );
};

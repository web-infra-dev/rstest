import { Button, Tooltip, Typography } from 'antd';
import { ExternalLink, RotateCw } from 'lucide-react';
import React from 'react';

type TestFileTitleProps = {
  icon: React.ReactNode;
  iconColor: string;
  relativePath: string;
  onOpen: () => void;
  onRerun: () => void;
  textColor: string;
};

const { Text } = Typography;

export const TestFileTitle: React.FC<TestFileTitleProps> = ({
  icon,
  iconColor,
  relativePath,
  onOpen,
  onRerun,
  textColor,
}) => {
  return (
    <div
      className="grid w-full items-center gap-2"
      style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}
    >
      <span className="flex w-[18px] shrink-0" style={{ color: iconColor }}>
        {icon}
      </span>
      <Tooltip
        title={relativePath}
        overlayInnerStyle={{ whiteSpace: 'nowrap', maxWidth: 'none' }}
      >
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold">
          {relativePath}
        </span>
      </Tooltip>
      <div className="flex items-center gap-1">
        <Tooltip title="Open in editor">
          <Button
            type="text"
            size="small"
            icon={<ExternalLink size={14} />}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex h-5 w-5 items-center justify-center p-0"
            style={{ color: textColor }}
          />
        </Tooltip>
        <Tooltip title="Re-run this file">
          <Button
            type="text"
            size="small"
            icon={<RotateCw size={14} />}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onRerun();
            }}
            className="inline-flex h-5 w-5 items-center justify-center p-0"
            style={{ color: textColor }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

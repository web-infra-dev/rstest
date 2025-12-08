import { Button, Tooltip } from 'antd';
import { RotateCw } from 'lucide-react';
import React from 'react';

type TestCaseTitleProps = {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  onRerun: () => void;
  buttonTextColor: string;
};

export const TestCaseTitle: React.FC<TestCaseTitleProps> = ({
  icon,
  iconColor,
  label,
  onRerun,
  buttonTextColor,
}) => {
  return (
    <div
      className="grid w-full items-center gap-2"
      style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}
    >
      {icon && (
        <span className="flex shrink-0" style={{ color: iconColor }}>
          {icon}
        </span>
      )}
      <Tooltip title={label}>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
          {label}
        </span>
      </Tooltip>
      <Tooltip title="Re-run this test">
        <Button
          type="text"
          size="small"
          icon={<RotateCw size={14} />}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRerun();
          }}
          className="inline-flex h-5 w-5 items-center justify-center p-0"
          style={{ color: buttonTextColor }}
        />
      </Tooltip>
    </div>
  );
};

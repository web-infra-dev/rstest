import { Button, Tooltip } from 'antd';
import { RotateCw } from 'lucide-react';
import React from 'react';

type TestSuiteTitleProps = {
  icon: React.ReactNode;
  iconColor: string;
  name: string;
  onRerun: () => void;
  buttonTextColor: string;
};

export const TestSuiteTitle: React.FC<TestSuiteTitleProps> = ({
  icon,
  iconColor,
  name,
  onRerun,
  buttonTextColor,
}) => {
  return (
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
      {icon && (
        <span className="flex shrink-0" style={{ color: iconColor }}>
          {icon}
        </span>
      )}
      <Tooltip title={name} mouseLeaveDelay={0}>
        <span className="truncate text-[13px] font-medium">{name}</span>
      </Tooltip>
      <Tooltip title="Re-run this suite" mouseLeaveDelay={0}>
        <Button
          type="text"
          size="small"
          icon={<RotateCw size={14} />}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRerun();
          }}
          className="inline-flex! h-5! w-5! items-center justify-center p-0!"
          style={{ color: buttonTextColor }}
        />
      </Tooltip>
    </div>
  );
};

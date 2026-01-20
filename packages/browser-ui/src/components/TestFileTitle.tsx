import { Button, Tooltip } from 'antd';
import { RotateCw, SquareArrowOutUpRight } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { TestStatus } from '../utils/constants';

type TestFileTitleProps = {
  icon: React.ReactNode;
  iconColor: string;
  status: TestStatus;
  relativePath: string;
  filePath: string;
  onOpen: () => void;
  onRerun?: () => void;
  textColor: string;
};

/** Statuses that trigger a flash animation on icon change */
const FLASH_STATUSES: TestStatus[] = ['pass', 'fail'];

export const TestFileTitle: React.FC<TestFileTitleProps> = ({
  icon,
  iconColor,
  status,
  relativePath,
  filePath,
  onOpen,
  onRerun,
  textColor,
}) => {
  const prevStatusRef = useRef<TestStatus | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  const shouldFlash = FLASH_STATUSES.includes(status);

  useEffect(() => {
    // Only trigger flash when status actually changes to a flash-worthy status
    if (
      shouldFlash &&
      prevStatusRef.current !== null &&
      prevStatusRef.current !== status
    ) {
      setFlashKey((k) => k + 1);
    }
    prevStatusRef.current = status;
  }, [status, shouldFlash]);

  return (
    <div
      className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
      data-testid="test-file-title"
      data-test-file={filePath}
    >
      <span
        key={flashKey}
        className={`flex w-[16px] shrink-0 items-center justify-center ${flashKey > 0 ? 'status-icon-flash' : ''}`}
        style={{ color: iconColor }}
      >
        {icon}
      </span>
      <Tooltip
        title={relativePath}
        styles={{
          container: {
            whiteSpace: 'nowrap',
            maxWidth: 'none',
          },
        }}
        mouseLeaveDelay={0}
      >
        <span className="truncate font-mono text-[12px] font-medium tracking-tight opacity-90">
          {relativePath}
        </span>
      </Tooltip>
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <Tooltip title="Open in editor" mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            icon={<SquareArrowOutUpRight size={14} strokeWidth={2.5} />}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex h-5 w-5 items-center justify-center p-0"
            data-testid="test-file-open-editor"
            style={{ color: textColor }}
          />
        </Tooltip>
        <Tooltip title="Re-run this file" mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            icon={<RotateCw size={14} strokeWidth={2.5} />}
            disabled={!onRerun}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onRerun?.();
            }}
            className="inline-flex h-5 w-5 items-center justify-center p-0"
            data-testid="test-file-rerun"
            style={{ color: textColor }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

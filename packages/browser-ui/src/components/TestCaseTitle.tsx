import { Button, Tooltip } from 'antd';
import { RotateCw } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { CaseStatus } from '../utils/constants';

type TestCaseTitleProps = {
  icon: React.ReactNode;
  iconColor: string;
  status: CaseStatus;
  label: string;
  caseId: string;
  onRerun?: () => void;
  buttonTextColor: string;
};

/** Statuses that trigger a flash animation on icon change */
const FLASH_STATUSES: CaseStatus[] = ['pass', 'fail', 'skip'];

export const TestCaseTitle: React.FC<TestCaseTitleProps> = ({
  icon,
  iconColor,
  status,
  label,
  caseId,
  onRerun,
  buttonTextColor,
}) => {
  const prevStatusRef = useRef<CaseStatus | null>(null);
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
      data-testid="test-case-title"
      data-test-case={caseId}
    >
      {icon && (
        <span
          key={flashKey}
          className={`flex w-[16px] shrink-0 items-center justify-center ${flashKey > 0 ? 'status-icon-flash' : ''}`}
          style={{ color: iconColor }}
        >
          {icon}
        </span>
      )}
      <Tooltip title={label} mouseLeaveDelay={0}>
        <span className="truncate text-[13px] tracking-tight opacity-70">
          {label}
        </span>
      </Tooltip>
      <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <Tooltip title="Re-run this test" mouseLeaveDelay={0}>
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
            data-testid="test-case-rerun"
            style={{ color: buttonTextColor }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

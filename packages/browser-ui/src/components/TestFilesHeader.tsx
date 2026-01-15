import { Button, Input, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { FoldVertical, RotateCw, Search, UnfoldVertical } from 'lucide-react';
import React from 'react';
import type { StatusCounts } from './StatusGrid';
import { StatusGrid } from './StatusGrid';

type TestFilesHeaderProps = {
  token: GlobalToken;
  filterText: string;
  onFilterChange: (value: string) => void;
  isAllExpanded: boolean;
  onToggleExpandAll: () => void;
  onRerun?: () => void;
  counts: StatusCounts;
  isRunning: boolean;
};

export const TestFilesHeader: React.FC<TestFilesHeaderProps> = ({
  token,
  filterText,
  onFilterChange,
  isAllExpanded,
  onToggleExpandAll,
  onRerun,
  counts,
  isRunning,
}) => {
  return (
    <div
      className="flex flex-col gap-3 px-4 py-3"
      style={{
        background: token.colorBgContainer,
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <StatusGrid counts={counts} isRunning={isRunning} />
        </div>
        <div className="flex items-center gap-2">
          <Tooltip
            title={isAllExpanded ? 'Collapse all' : 'Expand all'}
            mouseLeaveDelay={0}
          >
            <Button
              type="text"
              size="small"
              icon={
                isAllExpanded ? (
                  <FoldVertical size={14} strokeWidth={2.5} />
                ) : (
                  <UnfoldVertical size={14} strokeWidth={2.5} />
                )
              }
              onClick={onToggleExpandAll}
              className="flex h-7 w-7 items-center justify-center rounded-md p-0"
              style={{ color: token.colorTextDescription }}
            />
          </Tooltip>
          <Tooltip title="Re-run all tests" mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              icon={<RotateCw size={14} strokeWidth={2.5} />}
              onClick={onRerun}
              disabled={!onRerun}
              className="flex h-7 w-7 items-center justify-center rounded-md p-0"
              style={{ color: token.colorTextDescription }}
            />
          </Tooltip>
        </div>
      </div>
      <Input
        placeholder="Search tests..."
        prefix={<Search size={14} strokeWidth={2.5} className="opacity-40" />}
        value={filterText}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onFilterChange(e.target.value)
        }
        allowClear
        className="rounded-md py-1.5"
      />
    </div>
  );
};

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
};

export const TestFilesHeader: React.FC<TestFilesHeaderProps> = ({
  token,
  filterText,
  onFilterChange,
  isAllExpanded,
  onToggleExpandAll,
  onRerun,
  counts,
}) => {
  return (
    <div
      className="flex flex-col gap-2 px-3 py-2"
      style={{
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <div className="flex items-center justify-between">
        <StatusGrid counts={counts} />
        <div className="flex items-center gap-1">
          <Tooltip
            title={isAllExpanded ? 'Collapse all' : 'Expand all'}
            mouseLeaveDelay={0}
          >
            <Button
              type="text"
              size="small"
              icon={
                isAllExpanded ? (
                  <FoldVertical size={14} />
                ) : (
                  <UnfoldVertical size={14} />
                )
              }
              onClick={onToggleExpandAll}
              className="inline-flex! h-5! w-5! items-center justify-center p-0!"
              style={{ color: token.colorTextSecondary }}
            />
          </Tooltip>
          <Tooltip title="Re-run all tests" mouseLeaveDelay={0}>
            <Button
              type="text"
              size="small"
              icon={<RotateCw size={14} />}
              onClick={onRerun}
              disabled={!onRerun}
              className="inline-flex! h-5! w-5! items-center justify-center p-0!"
              style={{ color: token.colorTextSecondary }}
            />
          </Tooltip>
        </div>
      </div>
      <Input
        placeholder="Filter tests..."
        prefix={<Search size={14} className="text-gray-400" />}
        value={filterText}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onFilterChange(e.target.value)
        }
        allowClear
        size="small"
      />
    </div>
  );
};

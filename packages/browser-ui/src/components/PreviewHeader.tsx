import { App, Button, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Copy, SquareArrowOutUpRight } from 'lucide-react';
import React from 'react';
import { openInEditor, toRelativePath } from '../utils';
import { STATUS_META, type TestStatus } from '../utils/constants';

type PreviewHeaderProps = {
  token: GlobalToken;
  activeFile?: string;
  rootPath?: string;
  status?: TestStatus;
};

export const PreviewHeader: React.FC<PreviewHeaderProps> = ({
  token,
  activeFile,
  rootPath,
  status,
}) => {
  const { message } = App.useApp();
  const meta = status ? STATUS_META[status] : undefined;
  const relativePath = activeFile ? toRelativePath(activeFile, rootPath) : '';
  const pathParts = relativePath.split('/');
  const fileName = pathParts.pop();
  const dirPath = pathParts.join('/');

  const handleCopy = async () => {
    if (relativePath) {
      await navigator.clipboard.writeText(relativePath);
      message.success('relative path copied');
    }
  };

  // Map internal status to Geist scale name
  const colorKey =
    status === 'pass'
      ? 'green'
      : status === 'fail'
        ? 'red'
        : status === 'running'
          ? 'amber'
          : null;

  return (
    <div
      className="flex h-[48px] items-center justify-between px-4"
      style={{
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorder}`,
      }}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="text-[11px] font-medium tracking-wider text-(--accents-5) shrink-0">
          PREVIEW
        </span>
        <span className="text-(--accents-3) font-light select-none shrink-0">
          /
        </span>
        <div className="flex items-center gap-1.5 overflow-hidden">
          {dirPath && (
            <>
              <span
                className="text-[12px] font-mono tracking-tight text-(--accents-5) truncate max-w-[400px] hover:text-(--accents-6) transition-colors cursor-default"
                title={dirPath}
              >
                {dirPath}
              </span>
              <span className="text-(--accents-3) font-light select-none shrink-0">
                /
              </span>
            </>
          )}
          {fileName ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[12px] font-mono font-semibold tracking-tight text-foreground">
                {fileName}
              </span>
              {activeFile && (
                <div className="flex items-center">
                  <Tooltip title="Copy relative path" mouseLeaveDelay={0}>
                    <Button
                      type="text"
                      size="small"
                      className="flex h-5 w-5 items-center justify-center rounded-md p-0 text-(--accents-4) hover:text-foreground hover:bg-(--accents-1) transition-all"
                      icon={<Copy size={12} strokeWidth={2.5} />}
                      onClick={handleCopy}
                    />
                  </Tooltip>
                  <Tooltip title="Open in Editor" mouseLeaveDelay={0}>
                    <Button
                      type="text"
                      size="small"
                      className="flex h-5 w-5 items-center justify-center rounded-md p-0 text-(--accents-4) hover:text-foreground hover:bg-(--accents-1) transition-all"
                      icon={
                        <SquareArrowOutUpRight size={12} strokeWidth={2.5} />
                      }
                      onClick={() => openInEditor(activeFile)}
                    />
                  </Tooltip>
                </div>
              )}
            </div>
          ) : (
            <span className="text-[13px] tracking-tight text-(--accents-4) shrink-0">
              Select a test file
            </span>
          )}
        </div>
      </div>

      {meta && colorKey && (
        <div
          className="flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wider transition-colors shrink-0"
          style={{
            backgroundColor: `var(--ds-${colorKey}-100)`,
            color: `var(--ds-${colorKey}-900)`,
            border: `1px solid var(--ds-${colorKey}-300)`,
          }}
        >
          {meta.label.toUpperCase()}
        </div>
      )}
    </div>
  );
};

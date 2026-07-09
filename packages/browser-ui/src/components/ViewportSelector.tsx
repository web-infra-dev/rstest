import { Button, InputNumber, Popover, Select, Tooltip } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { Maximize, Ratio, Scaling, Smartphone, Tablet } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import type { ViewportSelection } from '../utils/viewport';
import {
  DEVICE_PRESETS,
  type DevicePreset,
  getPresetInfo,
} from '../utils/viewportPresets';

type ViewportSelectorProps = {
  token: GlobalToken;
  value: ViewportSelection;
  onChange: (next: ViewportSelection) => void;
};

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const presetLabelWithSize = (preset: DevicePreset): string => {
  const info = getPresetInfo(preset);
  return `${info.label} (${info.width} x ${info.height})`;
};

const currentLabel = (value: ViewportSelection): string => {
  if (value.mode === 'full') {
    return 'Full';
  }
  if (value.mode === 'responsive') {
    return `${value.width} x ${value.height}`;
  }
  return getPresetInfo(value.preset).label;
};

const currentIcon = (value: ViewportSelection): React.ReactNode => {
  if (value.mode === 'full') {
    return <Maximize size={14} strokeWidth={2.2} />;
  }
  if (value.mode === 'responsive') {
    return <Scaling size={14} strokeWidth={2.2} />;
  }

  const label = getPresetInfo(value.preset).label;
  if (
    label.startsWith('iPad') ||
    label.startsWith('Surface') ||
    label.startsWith('Nest Hub') ||
    label.includes('Fold')
  ) {
    return <Tablet size={14} strokeWidth={2.2} />;
  }
  return <Smartphone size={14} strokeWidth={2.2} />;
};

export const ViewportSelector: React.FC<ViewportSelectorProps> = ({
  token,
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const lastResponsiveRef = useRef({
    width: 800,
    height: 600,
  });

  if (value.mode === 'responsive') {
    lastResponsiveRef.current = { width: value.width, height: value.height };
  }

  const selectValue: string =
    value.mode === 'full'
      ? 'full'
      : value.mode === 'responsive'
        ? 'responsive'
        : value.preset;

  const options = useMemo(
    () => [
      { value: 'full', label: 'Full' },
      { value: 'responsive', label: 'Responsive' },
      ...DEVICE_PRESETS.map((p) => ({
        value: p.id,
        label: presetLabelWithSize(p.id),
      })),
    ],
    [],
  );

  const popover = (
    <div className="w-[280px]" data-testid="viewport-popover">
      <div className="flex items-center gap-2">
        <Select
          value={selectValue}
          options={options}
          listHeight={280}
          dropdownStyle={{ maxHeight: 280, overflowY: 'auto' }}
          onChange={(next: string) => {
            if (next === 'full') {
              onChange({ mode: 'full' });
              setOpen(false);
              return;
            }
            if (next === 'responsive') {
              const fallback =
                value.mode === 'responsive'
                  ? { width: value.width, height: value.height }
                  : lastResponsiveRef.current;
              onChange({ mode: 'responsive', ...fallback });
              return;
            }

            const preset = next as DevicePreset;
            onChange({
              mode: 'preset',
              preset,
              orientation:
                value.mode === 'preset' && value.preset === preset
                  ? value.orientation
                  : 'portrait',
            });
            setOpen(false);
          }}
          size="small"
          className="flex-1"
          popupMatchSelectWidth={false}
          data-testid="viewport-preset-select"
        />

        <Tooltip title="Rotate" mouseLeaveDelay={0}>
          <Button
            type="text"
            size="small"
            disabled={value.mode === 'full'}
            className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-(--accents-4) hover:text-foreground hover:bg-(--accents-1) transition-all"
            data-testid="viewport-rotate"
            aria-label="Rotate viewport"
            icon={<Ratio size={14} strokeWidth={2.2} />}
            onClick={() => {
              if (value.mode === 'full') return;
              if (value.mode === 'responsive') {
                const next = {
                  mode: 'responsive' as const,
                  width: value.height,
                  height: value.width,
                };
                lastResponsiveRef.current = {
                  width: next.width,
                  height: next.height,
                };
                onChange(next);
                return;
              }
              onChange({
                mode: 'preset',
                preset: value.preset,
                orientation:
                  value.orientation === 'portrait' ? 'landscape' : 'portrait',
              });
            }}
          />
        </Tooltip>
      </div>

      {value.mode === 'responsive' && (
        <div
          className="mt-3 flex items-center gap-2"
          data-testid="viewport-inputs"
        >
          <InputNumber
            min={1}
            max={10000}
            step={1}
            controls={false}
            value={value.width}
            onChange={(w: number | null) => {
              const width = clamp(Number(w ?? value.width), 1, 10000);
              lastResponsiveRef.current = { width, height: value.height };
              onChange({ mode: 'responsive', width, height: value.height });
            }}
            size="small"
            className="w-[120px]"
            data-testid="viewport-width-input"
            aria-label="Viewport width"
          />
          <span className="text-(--accents-4) select-none">x</span>
          <InputNumber
            min={1}
            max={10000}
            step={1}
            controls={false}
            value={value.height}
            onChange={(h: number | null) => {
              const height = clamp(Number(h ?? value.height), 1, 10000);
              lastResponsiveRef.current = { width: value.width, height };
              onChange({ mode: 'responsive', width: value.width, height });
            }}
            size="small"
            className="w-[120px]"
            data-testid="viewport-height-input"
            aria-label="Viewport height"
          />
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={popover}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
    >
      <Button
        type="text"
        size="small"
        className="flex h-7 items-center gap-2 rounded-md px-2 text-(--accents-6) hover:text-foreground hover:bg-(--accents-1) transition-all"
        data-testid="viewport-button"
        aria-label="Viewport"
      >
        <span className="flex h-4 w-4 items-center justify-center text-(--accents-5)">
          {currentIcon(value)}
        </span>
        <span
          className="text-[12px] font-mono tracking-tight leading-none"
          style={{ color: token.colorTextSecondary }}
        >
          {currentLabel(value)}
        </span>
      </Button>
    </Popover>
  );
};

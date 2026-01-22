import {
  CheckCircle2,
  CircleDashed,
  Loader,
  Sparkles,
  XCircle,
} from 'lucide-react';
import React from 'react';
import type { BrowserHostConfig } from '../types';

export type TestStatus = 'idle' | 'running' | 'pass' | 'fail';
export type CaseStatus = TestStatus | 'skip';

export type StatusMeta = {
  label: string;
  color: string;
  icon: React.ReactNode;
};

export const STATUS_META: Record<TestStatus, StatusMeta> = {
  idle: {
    label: 'Idle',
    color: 'var(--accents-5)',
    icon: <Sparkles size={14} strokeWidth={2.5} />,
  },
  running: {
    label: 'Running',
    color: 'var(--ds-amber-700)',
    icon: <Loader size={14} className="animate-spin" strokeWidth={2.5} />,
  },
  pass: {
    label: 'Pass',
    color: 'var(--ds-green-700)',
    icon: <CheckCircle2 size={14} strokeWidth={2.5} />,
  },
  fail: {
    label: 'Fail',
    color: 'var(--ds-red-800)',
    icon: <XCircle size={14} strokeWidth={2.5} />,
  },
};

export const CASE_STATUS_META: Record<CaseStatus, StatusMeta> = {
  ...STATUS_META,
  skip: {
    label: 'Skip',
    color: 'var(--accents-4)',
    icon: <CircleDashed size={14} strokeWidth={2.5} />,
  },
};

export type CaseInfo = {
  id: string;
  name: string;
  parentNames: string[];
  fullName: string;
  status: CaseStatus;
  filePath: string;
  location?: {
    line: number;
    column?: number;
    file?: string;
  };
};

export type ContainerWindow = Window &
  typeof globalThis & {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
  };

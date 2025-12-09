import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Sparkles,
  XCircle,
} from 'lucide-react';
import React from 'react';
import type { BrowserHostConfig } from './types';

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
    color: '#d1d5db',
    icon: <Sparkles size={16} strokeWidth={2.1} />,
  },
  running: {
    label: 'Running',
    color: '#f2c94c',
    icon: <Loader2 size={16} className="animate-spin" strokeWidth={2.1} />,
  },
  pass: {
    label: 'Pass',
    color: '#4ade80',
    icon: <CheckCircle2 size={16} strokeWidth={2.1} />,
  },
  fail: {
    label: 'Fail',
    color: '#f87171',
    icon: <XCircle size={16} strokeWidth={2.1} />,
  },
};

export const CASE_STATUS_META: Record<CaseStatus, StatusMeta> = {
  ...STATUS_META,
  skip: {
    label: 'Skip',
    color: '#9ca3af',
    icon: <CircleDashed size={16} strokeWidth={2.1} />,
  },
};

export type CaseInfo = {
  id: string;
  label: string;
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
    __rstest_container_dispatch__?: (data: unknown) => void;
    __rstest_container_on__?: (cb: (data: unknown) => void) => void;
    __rstest_dispatch__?: (payload: unknown) => void;
  };

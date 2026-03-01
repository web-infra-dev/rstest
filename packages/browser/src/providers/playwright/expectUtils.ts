/**
 * Contains adapted logic from Playwright matchers:
 * https://github.com/microsoft/playwright/blob/main/packages/playwright/src/matchers/matchers.ts
 * Copyright (c) Microsoft Corporation, Apache-2.0.
 */
import type { BrowserLocatorText } from '../../rpcProtocol';

type ExpectedTextValue = {
  string?: string;
  regexSource?: string;
  regexFlags?: string;
  matchSubstring?: boolean;
  ignoreCase?: boolean;
  normalizeWhiteSpace?: boolean;
};

export const serializeExpectedText = (
  text: BrowserLocatorText,
  options?: {
    matchSubstring?: boolean;
    normalizeWhiteSpace?: boolean;
    ignoreCase?: boolean;
  },
): ExpectedTextValue[] => {
  const base: ExpectedTextValue = {
    matchSubstring: options?.matchSubstring,
    ignoreCase: options?.ignoreCase,
    normalizeWhiteSpace: options?.normalizeWhiteSpace,
  };

  if (text.type === 'string') {
    return [{ ...base, string: text.value }];
  }

  return [
    {
      ...base,
      regexSource: text.source,
      regexFlags: text.flags,
    },
  ];
};

export const formatExpectError = (result: {
  errorMessage?: string;
  log?: string[];
}): string => {
  const parts: string[] = [];
  if (result.errorMessage) {
    parts.push(result.errorMessage);
  }
  if (result.log?.length) {
    parts.push('Call log:');
    parts.push(...result.log.map((l) => `- ${l}`));
  }
  return parts.join('\n');
};

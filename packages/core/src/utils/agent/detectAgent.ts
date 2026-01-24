/*!
 * Copyright 2017 Vercel, Inc.
 *
 * This file is derived from Vercel's detect-agent:
 *   https://github.com/vercel/vercel/tree/main/packages/detect-agent
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modifications in this derived work:
 *   - Removed async determine logic, kept only env detection.
 */

/* cspell:disable */

const CURSOR = 'cursor';
const CURSOR_CLI = 'cursor-cli';
const CLAUDE = 'claude';
const DEVIN = 'devin';
const REPLIT = 'replit';
const GEMINI = 'gemini';
const CODEX = 'codex';
const AUGMENT_CLI = 'augment-cli';
const OPENCODE = 'opencode';

export type KnownAgentNames =
  | typeof CURSOR
  | typeof CURSOR_CLI
  | typeof CLAUDE
  | typeof DEVIN
  | typeof REPLIT
  | typeof GEMINI
  | typeof CODEX
  | typeof AUGMENT_CLI
  | typeof OPENCODE;

export interface KnownAgentDetails {
  name: KnownAgentNames;
}

export type AgentResult =
  | {
      isAgent: true;
      agent: KnownAgentDetails;
    }
  | {
      isAgent: false;
      agent: undefined;
    };

export const KNOWN_AGENTS: {
  CURSOR: typeof CURSOR;
  CURSOR_CLI: typeof CURSOR_CLI;
  CLAUDE: typeof CLAUDE;
  DEVIN: typeof DEVIN;
  REPLIT: typeof REPLIT;
  GEMINI: typeof GEMINI;
  CODEX: typeof CODEX;
  AUGMENT_CLI: typeof AUGMENT_CLI;
  OPENCODE: typeof OPENCODE;
} = {
  CURSOR,
  CURSOR_CLI,
  CLAUDE,
  DEVIN,
  REPLIT,
  GEMINI,
  CODEX,
  AUGMENT_CLI,
  OPENCODE,
};

export function determineAgent(): AgentResult {
  if (process.env.AI_AGENT) {
    const name = process.env.AI_AGENT.trim();
    if (name) {
      return {
        isAgent: true,
        agent: { name: name as KnownAgentNames },
      };
    }
  }

  if (process.env.CURSOR_TRACE_ID) {
    return { isAgent: true, agent: { name: CURSOR } };
  }

  if (process.env.CURSOR_AGENT) {
    return { isAgent: true, agent: { name: CURSOR_CLI } };
  }

  if (process.env.GEMINI_CLI) {
    return { isAgent: true, agent: { name: GEMINI } };
  }

  if (process.env.CODEX_SANDBOX) {
    return { isAgent: true, agent: { name: CODEX } };
  }

  if (process.env.AUGMENT_AGENT) {
    return { isAgent: true, agent: { name: AUGMENT_CLI } };
  }

  if (process.env.OPENCODE) {
    return { isAgent: true, agent: { name: OPENCODE } };
  }

  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE) {
    return { isAgent: true, agent: { name: CLAUDE } };
  }

  if (process.env.REPL_ID) {
    return { isAgent: true, agent: { name: REPLIT } };
  }

  return { isAgent: false, agent: undefined };
}

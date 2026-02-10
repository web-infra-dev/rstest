/**
 * Protocol and shared types for @rstest/midscene integration.
 */

export const MIDSCENE_NAMESPACE = 'midscene';
export const AI_RPC_TIMEOUT_MS = 120_000;

export interface PromptImage {
  name: string;
  url: string;
}

export type PromptInput =
  | string
  | {
      prompt: string;
      images?: PromptImage[];
      convertHttpImage2Base64?: boolean;
    };

export interface LocateActionOptions {
  deepThink?: boolean;
  xpath?: string;
  cacheable?: boolean;
}

export interface QueryOptions {
  domIncluded?: boolean | 'visible-only';
  screenshotIncluded?: boolean;
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface ScrollOptions extends LocateActionOptions {
  scrollType?:
    | 'singleAction'
    | 'scrollToBottom'
    | 'scrollToTop'
    | 'scrollToRight'
    | 'scrollToLeft'
    | 'once'
    | 'untilBottom'
    | 'untilTop'
    | 'untilRight'
    | 'untilLeft';
  direction?: ScrollDirection;
  distance?: number | null;
}

export interface AiActOptions {
  cacheable?: boolean;
  deepThink?: 'unset' | boolean;
  fileChooserAccept?: string | string[];
}

export interface AiInputOptions extends LocateActionOptions {
  value: string | number;
  autoDismissKeyboard?: boolean;
  mode?: 'replace' | 'clear' | 'typeOnly';
}

export interface AiKeyboardPressOptions extends LocateActionOptions {
  keyName: string;
}

export interface AiWaitForOptions {
  timeoutMs?: number;
  checkIntervalMs?: number;
}

export interface RecordToReportOptions {
  content?: string;
}

export interface LocateResult {
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  center?: [number, number];
  scale?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface RunYamlResult {
  result: unknown;
}

export type AiRpcArgsMap = {
  ai: [prompt: string];
  aiTap: [locate: PromptInput, options?: LocateActionOptions];
  aiRightClick: [locate: PromptInput, options?: LocateActionOptions];
  aiDoubleClick: [locate: PromptInput, options?: LocateActionOptions];
  aiHover: [locate: PromptInput, options?: LocateActionOptions];
  aiInput:
    | [locate: PromptInput, options: AiInputOptions]
    | [
        locate: PromptInput,
        value: string | number,
        options?: Omit<AiInputOptions, 'value'>,
      ];
  aiKeyboardPress:
    | [locate: PromptInput, options: AiKeyboardPressOptions]
    | [
        key: string,
        locate?: PromptInput,
        options?: Omit<AiKeyboardPressOptions, 'keyName'>,
      ];
  aiScroll:
    | [locate: PromptInput | undefined, options: ScrollOptions]
    | [
        scrollParam: ScrollOptions,
        locate?: PromptInput,
        options?: LocateActionOptions,
      ];
  aiAct: [prompt: string, options?: AiActOptions];
  aiQuery: [dataDemand: PromptInput, options?: QueryOptions];
  aiAssert: [
    assertion: PromptInput,
    errorMsgOrOptions?: string | QueryOptions,
    options?: QueryOptions,
  ];
  aiWaitFor: [condition: string, options?: AiWaitForOptions];
  aiLocate: [locate: PromptInput, options?: LocateActionOptions];
  aiBoolean: [prompt: PromptInput, options?: QueryOptions];
  aiNumber: [prompt: PromptInput, options?: QueryOptions];
  aiString: [prompt: PromptInput, options?: QueryOptions];
  aiAsk: [prompt: PromptInput, options?: QueryOptions];
  runYaml: [yamlScriptContent: string];
  setAIActContext: [aiActContext: string];
  evaluateJavaScript: [script: string];
  recordToReport: [title?: string, options?: RecordToReportOptions];
  freezePageContext: [];
  unfreezePageContext: [];
  _unstableLogContent: [];
};

export type AiRpcResultMap = {
  ai: void;
  aiTap: void;
  aiRightClick: void;
  aiDoubleClick: void;
  aiHover: void;
  aiInput: void;
  aiKeyboardPress: void;
  aiScroll: void;
  aiAct: void;
  aiQuery: unknown;
  aiAssert: void;
  aiWaitFor: void;
  aiLocate: LocateResult;
  aiBoolean: boolean;
  aiNumber: number;
  aiString: string;
  aiAsk: string;
  runYaml: RunYamlResult;
  setAIActContext: void;
  evaluateJavaScript: unknown;
  recordToReport: void;
  freezePageContext: void;
  unfreezePageContext: void;
  _unstableLogContent: unknown;
};

export type AiRpcMethod = keyof AiRpcArgsMap;
export type AiRpcMethodArgs<M extends AiRpcMethod> = AiRpcArgsMap[M];
export type AiRpcMethodResult<M extends AiRpcMethod> = AiRpcResultMap[M];

export const AI_RPC_METHODS: readonly AiRpcMethod[] = [
  'ai',
  'aiTap',
  'aiRightClick',
  'aiDoubleClick',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiAct',
  'aiQuery',
  'aiAssert',
  'aiWaitFor',
  'aiLocate',
  'aiBoolean',
  'aiNumber',
  'aiString',
  'aiAsk',
  'runYaml',
  'setAIActContext',
  'evaluateJavaScript',
  'recordToReport',
  'freezePageContext',
  'unfreezePageContext',
  '_unstableLogContent',
];

export const isAiRpcMethod = (value: unknown): value is AiRpcMethod =>
  typeof value === 'string' &&
  (AI_RPC_METHODS as readonly string[]).includes(value);

/**
 * AI RPC request from runner iframe to execute Midscene operations.
 */
export type AiRpcRequest<M extends AiRpcMethod = AiRpcMethod> = {
  id: string;
  /**
   * Runner instance identifier for stale-request protection.
   * Generated per iframe load/reload.
   */
  runId: string;
  method: M;
  args: AiRpcMethodArgs<M>;
};

/**
 * AI RPC response from host to runner iframe.
 */
export type AiRpcResponse<M extends AiRpcMethod = AiRpcMethod> = {
  id: string;
  result?: AiRpcMethodResult<M>;
  error?: string;
};

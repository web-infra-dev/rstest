/**
 * Protocol types for @rstest/midscene AI integration
 */

/**
 * AI RPC methods supported by the host
 */
export type AiRpcMethod =
  | 'aiTap'
  | 'aiRightClick'
  | 'aiDoubleClick'
  | 'aiHover'
  | 'aiInput'
  | 'aiKeyboardPress'
  | 'aiScroll'
  | 'aiAct'
  | 'aiQuery'
  | 'aiAssert'
  | 'aiWaitFor'
  | 'aiLocate'
  | 'aiBoolean'
  | 'aiNumber'
  | 'aiString';

/**
 * AI RPC request from runner iframe to execute Midscene AI operations.
 */
export type AiRpcRequest = {
  id: string;
  method: AiRpcMethod;
  args: unknown[];
};

/**
 * AI RPC response from host to runner iframe.
 */
export type AiRpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

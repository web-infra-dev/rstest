/**
 * Protocol types for @rstest/midscene
 *
 * These types define the communication protocol between the runner (browser)
 * and the host (Node.js) for controlling Playwright frame operations.
 *
 * Note: These types should be kept in sync with packages/core/src/browser/protocol.ts
 */

/**
 * Mouse click options
 */
export type FrameMouseClickOptions = {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
};

/**
 * Frame RPC request from runner iframe to control Playwright Frame.
 * The container will forward these to the host via WebSocket RPC.
 */
export type FrameRpcRequest =
  // Click operations (by selector)
  | {
      id: string;
      method: 'click';
      args: { selector: string; options?: FrameMouseClickOptions };
    }
  // Mouse operations (by coordinates)
  | {
      id: string;
      method: 'mouse.click';
      args: { x: number; y: number; options?: FrameMouseClickOptions };
    }
  | {
      id: string;
      method: 'mouse.dblclick';
      args: {
        x: number;
        y: number;
        options?: { button?: 'left' | 'right' | 'middle' };
      };
    }
  | {
      id: string;
      method: 'mouse.move';
      args: { x: number; y: number; steps?: number };
    }
  | {
      id: string;
      method: 'mouse.down';
      args: { button?: 'left' | 'right' | 'middle' };
    }
  | {
      id: string;
      method: 'mouse.up';
      args: { button?: 'left' | 'right' | 'middle' };
    }
  | {
      id: string;
      method: 'mouse.wheel';
      args: { deltaX: number; deltaY: number };
    }
  // Keyboard operations
  | {
      id: string;
      method: 'keyboard.type';
      args: { text: string; delay?: number };
    }
  | {
      id: string;
      method: 'keyboard.press';
      args: { key: string; delay?: number };
    }
  | {
      id: string;
      method: 'keyboard.down';
      args: { key: string };
    }
  | {
      id: string;
      method: 'keyboard.up';
      args: { key: string };
    }
  // Screenshot
  | {
      id: string;
      method: 'screenshot';
      args: { fullPage?: boolean };
    }
  // Evaluate JavaScript
  | {
      id: string;
      method: 'evaluate';
      args: { expression: string };
    }
  // Get viewport size
  | {
      id: string;
      method: 'getViewportSize';
      args: Record<string, never>;
    }
  // Get URL
  | {
      id: string;
      method: 'getUrl';
      args: Record<string, never>;
    };

/**
 * Frame RPC response from host to runner iframe.
 */
export type FrameRpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

/**
 * Viewport size returned by getViewportSize
 */
export type ViewportSize = {
  width: number;
  height: number;
  dpr?: number;
};

// ============================================================================
// AI RPC types for @rstest/midscene Agent integration
// ============================================================================

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
 * The container will forward these to the host via WebSocket RPC.
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

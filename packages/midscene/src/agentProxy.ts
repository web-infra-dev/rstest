/**
 * AgentProxy - Browser-side AI Agent API for @rstest/midscene.
 *
 * All operations are forwarded to the host (Node.js) via plugin RPC, where the
 * real Midscene Agent instance executes them.
 */

import { sendAiRpcRequest } from './aiRpc';
import type {
  AiActOptions,
  AiInputOptions,
  AiKeyboardPressOptions,
  AiRpcMethod,
  AiRpcMethodArgs,
  AiRpcMethodResult,
  AiWaitForOptions,
  LocateActionOptions,
  LocateResult,
  PromptImage,
  PromptInput,
  QueryOptions,
  RecordToReportOptions,
  RunYamlResult,
  ScrollDirection,
  ScrollOptions,
} from './protocol';

export type {
  AiActOptions,
  AiInputOptions,
  AiKeyboardPressOptions,
  AiWaitForOptions,
  LocateActionOptions,
  LocateResult,
  PromptImage,
  PromptInput,
  QueryOptions,
  RecordToReportOptions,
  RunYamlResult,
  ScrollDirection,
  ScrollOptions,
};

type VoidAiRpcMethod = {
  [K in AiRpcMethod]: AiRpcMethodResult<K> extends void ? K : never;
}[AiRpcMethod];

const withOptionalOptions = <T, U>(value: T, options?: U): [T] | [T, U] => {
  return options === undefined ? [value] : [value, options];
};

/**
 * AgentProxy class that forwards Midscene APIs to the host via RPC.
 */
export class AgentProxy {
  private send<M extends AiRpcMethod>(
    method: M,
    args: AiRpcMethodArgs<M>,
  ): Promise<AiRpcMethodResult<M>> {
    return sendAiRpcRequest(method, args);
  }

  private async sendVoid<M extends VoidAiRpcMethod>(
    method: M,
    args: AiRpcMethodArgs<M>,
  ): Promise<void> {
    await this.send(method, args);
  }

  /** Alias of aiAct */
  async ai(prompt: string): Promise<void> {
    await this.sendVoid('ai', [prompt]);
  }

  async aiTap(
    locate: PromptInput,
    options?: LocateActionOptions,
  ): Promise<void> {
    await this.sendVoid('aiTap', withOptionalOptions(locate, options));
  }

  async aiRightClick(
    locate: PromptInput,
    options?: LocateActionOptions,
  ): Promise<void> {
    await this.sendVoid('aiRightClick', withOptionalOptions(locate, options));
  }

  async aiDoubleClick(
    locate: PromptInput,
    options?: LocateActionOptions,
  ): Promise<void> {
    await this.sendVoid('aiDoubleClick', withOptionalOptions(locate, options));
  }

  async aiHover(
    locate: PromptInput,
    options?: LocateActionOptions,
  ): Promise<void> {
    await this.sendVoid('aiHover', withOptionalOptions(locate, options));
  }

  /**
   * Supports both signatures:
   * - aiInput(locate, { value, ... })
   * - aiInput(locate, value, options?)
   */
  async aiInput(
    ...args:
      | [locate: PromptInput, options: AiInputOptions]
      | [
          locate: PromptInput,
          value: string | number,
          options?: Omit<AiInputOptions, 'value'>,
        ]
  ): Promise<void> {
    if (typeof args[1] === 'object' && args[1] !== null) {
      await this.sendVoid('aiInput', [args[0], args[1]]);
      return;
    }

    const [locate, value, options] = args;
    const inputOptions: AiInputOptions = {
      ...(options || {}),
      value,
    };
    await this.sendVoid('aiInput', [locate, inputOptions]);
  }

  /**
   * Supports both signatures:
   * - aiKeyboardPress(locate, { keyName, ... })
   * - aiKeyboardPress(key, locate?, options?)
   */
  async aiKeyboardPress(
    ...args:
      | [locate: PromptInput, options: AiKeyboardPressOptions]
      | [
          key: string,
          locate?: PromptInput,
          options?: Omit<AiKeyboardPressOptions, 'keyName'>,
        ]
  ): Promise<void> {
    await this.sendVoid(
      'aiKeyboardPress',
      args as AiRpcMethodArgs<'aiKeyboardPress'>,
    );
  }

  /**
   * Supports both signatures:
   * - aiScroll(locate, options)
   * - aiScroll(scrollParam, locate?, options?)
   */
  async aiScroll(
    ...args:
      | [locate: PromptInput | undefined, options: ScrollOptions]
      | [
          scrollParam: ScrollOptions,
          locate?: PromptInput,
          options?: LocateActionOptions,
        ]
  ): Promise<void> {
    await this.sendVoid('aiScroll', args as AiRpcMethodArgs<'aiScroll'>);
  }

  async aiAct(prompt: string, options?: AiActOptions): Promise<void> {
    await this.sendVoid(
      'aiAct',
      options === undefined ? [prompt] : [prompt, options],
    );
  }

  async aiAsk(prompt: PromptInput, options?: QueryOptions): Promise<string> {
    return this.send(
      'aiAsk',
      options === undefined ? [prompt] : [prompt, options],
    );
  }

  async aiQuery<T = unknown>(
    dataDemand: PromptInput,
    options?: QueryOptions,
  ): Promise<T> {
    const result = await this.send(
      'aiQuery',
      options === undefined ? [dataDemand] : [dataDemand, options],
    );
    return result as T;
  }

  async aiAssert(
    assertion: PromptInput,
    errorMsgOrOptions?: string | QueryOptions,
    options?: QueryOptions,
  ): Promise<void> {
    if (typeof errorMsgOrOptions === 'string') {
      await this.sendVoid(
        'aiAssert',
        options === undefined
          ? [assertion, errorMsgOrOptions]
          : [assertion, errorMsgOrOptions, options],
      );
      return;
    }

    await this.sendVoid(
      'aiAssert',
      errorMsgOrOptions === undefined
        ? [assertion]
        : [assertion, undefined, errorMsgOrOptions],
    );
  }

  async aiWaitFor(
    condition: string,
    options?: AiWaitForOptions,
  ): Promise<void> {
    await this.sendVoid(
      'aiWaitFor',
      options === undefined ? [condition] : [condition, options],
    );
  }

  async aiLocate(
    locate: PromptInput,
    options?: LocateActionOptions,
  ): Promise<LocateResult> {
    return this.send(
      'aiLocate',
      options === undefined ? [locate] : [locate, options],
    );
  }

  async aiBoolean(
    prompt: PromptInput,
    options?: QueryOptions,
  ): Promise<boolean> {
    return this.send(
      'aiBoolean',
      options === undefined ? [prompt] : [prompt, options],
    );
  }

  async aiNumber(prompt: PromptInput, options?: QueryOptions): Promise<number> {
    return this.send(
      'aiNumber',
      options === undefined ? [prompt] : [prompt, options],
    );
  }

  async aiString(prompt: PromptInput, options?: QueryOptions): Promise<string> {
    return this.send(
      'aiString',
      options === undefined ? [prompt] : [prompt, options],
    );
  }

  async runYaml(yamlScriptContent: string): Promise<RunYamlResult> {
    return this.send('runYaml', [yamlScriptContent]);
  }

  async setAIActContext(aiActContext: string): Promise<void> {
    await this.sendVoid('setAIActContext', [aiActContext]);
  }

  async evaluateJavaScript(script: string): Promise<unknown> {
    return this.send('evaluateJavaScript', [script]);
  }

  async recordToReport(
    title?: string,
    options?: RecordToReportOptions,
  ): Promise<void> {
    if (title === undefined && options === undefined) {
      await this.sendVoid('recordToReport', []);
      return;
    }

    if (title !== undefined && options === undefined) {
      await this.sendVoid('recordToReport', [title]);
      return;
    }

    if (title === undefined) {
      await this.sendVoid('recordToReport', [undefined, options]);
      return;
    }

    await this.sendVoid('recordToReport', [title, options]);
  }

  async freezePageContext(): Promise<void> {
    await this.sendVoid('freezePageContext', []);
  }

  async unfreezePageContext(): Promise<void> {
    await this.sendVoid('unfreezePageContext', []);
  }

  async _unstableLogContent(): Promise<unknown> {
    return this.send('_unstableLogContent', []);
  }
}

/** Default AgentProxy instance for convenient import. */
export const agent: AgentProxy = new AgentProxy();

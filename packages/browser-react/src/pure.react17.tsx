import type { ReactNode } from 'react';
import * as ReactDOMLib from 'react-dom';
import * as TestUtilsLib from 'react-dom/test-utils';
import type { RenderApi } from './createRenderApi';
import { createRenderApi } from './createRenderApi';

// `@types/react-dom@19` removed these exports; redeclare for the React 17 path.
interface LegacyReactDOM {
  render: (element: ReactNode, container: Element) => void;
  unmountComponentAtNode: (container: Element) => boolean;
}

interface LegacyTestUtils {
  act: (callback: () => unknown) => Promise<void>;
}

function interopDefault<T>(mod: unknown): T {
  return ((mod as { default?: T }).default ?? mod) as T;
}

const ReactDOM = interopDefault<LegacyReactDOM>(ReactDOMLib);
const TestUtils = interopDefault<LegacyTestUtils>(TestUtilsLib);
const act: LegacyTestUtils['act'] = TestUtils.act;

const api: RenderApi = createRenderApi({
  createRoot: (container) => ({
    render: (element) => {
      ReactDOM.render(element, container);
    },
    unmount: () => {
      ReactDOM.unmountComponentAtNode(container);
    },
  }),
  act,
});

export type {
  RenderConfiguration,
  RenderHookOptions,
  RenderHookResult,
  RenderOptions,
  RenderResult,
} from './createRenderApi';

export const render: RenderApi['render'] = api.render;
export const renderHook: RenderApi['renderHook'] = api.renderHook;
export const cleanup: RenderApi['cleanup'] = api.cleanup;
export const configure: RenderApi['configure'] = api.configure;
export { act };

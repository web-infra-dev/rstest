import { createRoot as createReactRoot } from 'react-dom/client';
import { act } from './act';
import type { RenderApi } from './createRenderApi';
import { createRenderApi } from './createRenderApi';

const api: RenderApi = createRenderApi({
  createRoot: (container) => {
    const root = createReactRoot(container);
    return {
      render: (element) => root.render(element),
      unmount: () => root.unmount(),
    };
  },
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

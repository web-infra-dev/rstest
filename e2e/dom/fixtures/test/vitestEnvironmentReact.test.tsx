/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { describe, expect, it } from '@rstest/core';
import { createRoot } from 'react-dom/client';
import { EnvironmentCommentWidget } from '../src/EnvironmentCommentWidget';

describe('environment comment react', () => {
  it('keeps automatic JSX runtime when the file overrides environment', async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<EnvironmentCommentWidget />);
    });

    expect(container.textContent).toContain('widget-42');
  });
});

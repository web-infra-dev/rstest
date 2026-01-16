/**
 * Text input showcase test for browser mode demo video.
 *
 * Demonstrates real browser features that jsdom cannot replicate:
 * - Visible caret/cursor during typing
 * - Text selection highlighting
 * - Smooth, cinematic typing animation
 */
import { render } from '@rstest/browser-react';
import { expect, test } from '@rstest/core';
import { getByTestId } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { ContentEditableShowcase } from '../src/showcase/ContentEditableShowcase';

/** Small delay to make animations visible for recording */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('input: select all and type with visible caret', async () => {
  const { container } = await render(<ContentEditableShowcase />);

  const input = getByTestId(container, 'editable-title') as HTMLInputElement;

  // Use single userEvent instance with typing delay for visual effect
  const user = userEvent.setup({ delay: 60 });

  await delay(300);

  // Click to focus the input (shows focus ring)
  await user.click(input);
  await delay(300);

  // Triple-click to select all text in input (works cross-platform)
  await user.tripleClick(input);
  await delay(400);

  // Type new text - replaces selection with slow, visible typing (shows caret moving)
  await user.keyboard('REAL BROWSER');

  await delay(500);

  expect(input.value).toBe('REAL BROWSER');
});

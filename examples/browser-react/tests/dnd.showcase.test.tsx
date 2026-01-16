/**
 * Drag & Drop showcase test for browser mode demo video.
 *
 * Demonstrates real browser features that jsdom cannot replicate:
 * - HTML5 Drag and Drop with DataTransfer API
 * - Visual drop zone highlighting
 * - Card movement animation
 */
import { render } from '@rstest/browser-react';
import { expect, test } from '@rstest/core';
import { getByTestId } from '@testing-library/dom';
import { DragDropShowcase } from '../src/showcase/DragDropShowcase';

/** Small delay to make animations visible for recording */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch a native DragEvent with DataTransfer.
 * user-event's pointer API doesn't trigger HTML5 drag events.
 */
function fireDragEvent(
  element: Element,
  type: 'dragstart' | 'dragover' | 'drop' | 'dragleave' | 'dragend',
  dataTransfer: DataTransfer,
) {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  element.dispatchEvent(event);
}

test('drag and drop: move card from Inbox to Done', async () => {
  const { container } = await render(<DragDropShowcase />);

  const card = getByTestId(container, 'card-card-1');
  const dropZoneDone = getByTestId(container, 'drop-zone-done');

  await delay(300);

  // Create DataTransfer with card data
  const dataTransfer = new DataTransfer();
  dataTransfer.setData(
    'text/plain',
    JSON.stringify({
      card: { id: 'card-1', label: 'Design review' },
      from: 'inbox',
    }),
  );

  // Start drag (shows ghost image in real browser)
  fireDragEvent(card, 'dragstart', dataTransfer);
  await delay(200);

  // Hover over done zone (shows drop zone highlight)
  fireDragEvent(dropZoneDone, 'dragover', dataTransfer);
  await delay(400);

  // Drop the card (triggers state update)
  fireDragEvent(dropZoneDone, 'drop', dataTransfer);
  await delay(300);

  // End drag
  fireDragEvent(card, 'dragend', dataTransfer);
  await delay(300);

  // Verify card moved to Done
  const doneCards = dropZoneDone.querySelectorAll('[data-testid^="card-"]');
  expect(doneCards.length).toBe(1);
  expect(doneCards[0].textContent).toBe('Design review');
});

/**
 * MVP test for @rstest/midscene AI Agent integration
 */

import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';

describe('@rstest/midscene AI Agent MVP', () => {
  it('can perform AI action using natural language', async () => {
    // Create a simple input field
    const input = document.createElement('input');
    input.id = 'test-input';
    input.type = 'text';
    input.placeholder = 'Enter your name';
    input.style.padding = '12px 16px';
    input.style.fontSize = '16px';
    input.style.border = '2px solid #4CAF50';
    input.style.borderRadius = '8px';
    input.style.width = '300px';

    document.body.appendChild(input);

    // Use AI to type text into the input
    await agent.aiAct('type "Hello Midscene" into the input field');

    expect(input.value).toBe('Hello Midscene');

    // Cleanup
    document.body.removeChild(input);
  });
});

import { render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';
import { createElement } from 'react';
import { ReleaseChecklist } from '../src/ReleaseChecklist';

describe('@rstest/midscene assertion and query demo', () => {
  it('demonstrates aiAssert and additional query-oriented APIs', async () => {
    await render(createElement(ReleaseChecklist));

    await agent.setAIActContext(
      'Only interact with the release checklist section and its button.',
    );

    await agent.aiHover('Show audit note button');
    await agent.aiWaitFor('The audit note is visible');

    await agent.aiAssert(
      'The release checklist shows exactly 3 checks pending',
    );
    await agent.aiAssert(
      'The audit note says cache warm and smoke checks ready',
    );

    const itemCount = await agent.aiNumber(
      'How many checklist items are shown in the release checklist?',
    );
    expect(itemCount).toBe(3);

    const ownerText = await agent.aiString(
      'What owner is shown in the release checklist? Return only the owner name.',
    );
    expect(ownerText).toContain('Platform QA');

    const checklistLocation = await agent.aiLocate('Release checklist section');
    expect(checklistLocation.rect?.width ?? 0).toBeGreaterThan(0);
    expect(checklistLocation.rect?.height ?? 0).toBeGreaterThan(0);
  });
});

import { render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';
import { createElement } from 'react';
import { ReleaseChecklist } from '../src/ReleaseChecklist';

describe('@rstest/midscene assertion and query demo', () => {
  it('reviews release readiness details with assertion and query APIs', async () => {
    await render(createElement(ReleaseChecklist));

    await agent.setAIActContext(
      'You are checking the release checklist before a launch.',
    );

    await agent.aiAssert(
      'The release checklist shows owner "Platform QA" and summary "3 checks pending".',
    );

    await agent.aiHover(
      'the "Show audit note" button in the release checklist',
    );
    await agent.aiWaitFor(
      'the audit note below the "Show audit note" button is visible',
    );

    await agent.aiAssert(
      'The visible audit note says "Audit note: cache warm and smoke checks ready."',
    );

    const itemCount = await agent.aiNumber(
      'How many checklist items are shown in the release checklist? Return only the number.',
    );
    expect(itemCount).toBe(3);

    const ownerText = await agent.aiString(
      'In the release checklist, what is the owner name after "Owner:"? Return only the name.',
    );
    expect(ownerText).toContain('Platform QA');

    const firstCheck = await agent.aiString(
      'In the release checklist, what is the first item in the numbered list? Return only that item text.',
    );
    expect(firstCheck).toContain('Run smoke suite');

    const checklistLocation = await agent.aiLocate(
      'the release checklist card',
    );
    expect(checklistLocation.rect?.width ?? 0).toBeGreaterThan(0);
    expect(checklistLocation.rect?.height ?? 0).toBeGreaterThan(0);
  });
});

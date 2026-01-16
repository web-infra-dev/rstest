import { render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';
import { createElement } from 'react';
import { TaskBoard } from '../src/TaskBoard';

describe('@rstest/midscene advanced API demo', () => {
  it('can build a release follow-up list with mixed action APIs', async () => {
    await render(createElement(TaskBoard));

    await agent.setAIActContext(
      'You are updating the task board for a release follow-up checklist.',
    );

    await agent.aiAct(
      'Add one task named "Check rollout dashboard" to the task board.',
    );

    await agent.aiInput('the "Task title" input on the task board', {
      value: 'Send launch email',
      mode: 'replace',
    });
    await agent.aiTap('the "Add task" button beside the task title input');

    await agent.aiInput('the "Task title" input on the task board', {
      value: 'Archive dry-run notes',
      mode: 'replace',
    });
    await agent.aiKeyboardPress('the "Task title" input on the task board', {
      keyName: 'Enter',
    });

    await agent.aiAssert(
      'The task board shows "3 tasks" and the list includes "Check rollout dashboard", "Send launch email", and "Archive dry-run notes".',
    );

    const evalResult = (await agent.evaluateJavaScript(`
      (() => {
        return {
          count: document.querySelectorAll('#task-list li').length,
          status: document.querySelector('#status')?.textContent || '',
          tasks: Array.from(document.querySelectorAll('#task-list li')).map((el) => el.textContent || ''),
        };
      })()
    `)) as {
      count: number;
      status: string;
      tasks: string[];
    };

    expect(evalResult.count).toBe(3);
    expect(evalResult.status).toContain('3 tasks');
    expect(evalResult.tasks).toContain('Check rollout dashboard');
    expect(evalResult.tasks).toContain('Send launch email');
    expect(evalResult.tasks).toContain('Archive dry-run notes');
  });

  it('can review task board state with query and reporting APIs', async () => {
    await render(createElement(TaskBoard));

    await agent.setAIActContext(
      'You are reviewing the task board after a release standup.',
    );

    await agent.aiAct('Add one task named "Prepare support handoff".');
    await agent.aiInput('the "Task title" input on the task board', {
      value: 'Verify docs links',
      mode: 'replace',
    });
    await agent.aiKeyboardPress('the "Task title" input on the task board', {
      keyName: 'Enter',
    });

    await agent.freezePageContext();
    const statusSummary = await agent.aiAsk(
      'What does the task counter under the input say? Return only that text.',
    );
    const taskSummary = await agent.aiAsk(
      'List the task titles in the task board from top to bottom. Return only a comma-separated list.',
    );
    await agent.unfreezePageContext();

    expect(statusSummary).toContain('2 tasks');
    expect(taskSummary).toContain('Prepare support handoff');
    expect(taskSummary).toContain('Verify docs links');

    const hasDocsTask = await agent.aiBoolean(
      'Is there a task named "Verify docs links" in the task list?',
    );
    expect(hasDocsTask).toBe(true);

    const count = await agent.aiNumber(
      'How many tasks are shown in the task board? Return only the number.',
    );
    expect(count).toBe(2);

    await agent.recordToReport('Task board review snapshot', {
      content: `Status: ${statusSummary}. Tasks: ${taskSummary}.`,
    });
  });
});

import { render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';
import { createElement } from 'react';
import { TaskBoard } from '../src/TaskBoard';

describe('@rstest/midscene advanced API demo', () => {
  it('can add tasks with aiAct, aiTap, aiInput, and aiKeyboardPress', async () => {
    await render(createElement(TaskBoard));

    await agent.setAIActContext(
      'Only interact with the task board. Use the input with placeholder "Task title".',
    );

    await agent.aiAct('type "Ship release notes" into the Task title input', {
      cacheable: true,
    });
    await agent.aiTap('Add task button');

    await agent.aiInput('Task title input', {
      value: 'Prepare changelog',
      mode: 'replace',
    });
    await agent.aiKeyboardPress('Task title input', { keyName: 'Enter' });

    const hasFirstTask = await agent.aiBoolean(
      'Is there a task named "Ship release notes" in the list?',
    );
    const hasSecondTask = await agent.aiBoolean(
      'Is there a task named "Prepare changelog" in the list?',
    );

    expect(hasFirstTask).toBe(true);
    expect(hasSecondTask).toBe(true);

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

    expect(evalResult.count).toBe(2);
    expect(evalResult.status).toContain('2 tasks');
    expect(evalResult.tasks).toContain('Ship release notes');
    expect(evalResult.tasks).toContain('Prepare changelog');
  });

  it('can inspect task board state with query and reporting APIs', async () => {
    await render(createElement(TaskBoard));

    await agent.setAIActContext(
      'Only interact with the task board. Use the input with placeholder "Task title".',
    );

    await agent.aiInput('Task title input', {
      value: 'Prepare changelog',
      mode: 'replace',
    });
    await agent.aiKeyboardPress('Task title input', { keyName: 'Enter' });

    await agent.freezePageContext();
    const statusSummary = await agent.aiAsk(
      'What does the task status text say? Return only the status text.',
    );
    await agent.unfreezePageContext();

    expect(typeof statusSummary).toBe('string');
    expect(statusSummary.length).toBeGreaterThan(0);

    const hasSecondTask = await agent.aiBoolean(
      'Is there a task named "Prepare changelog" in the list?',
    );
    expect(hasSecondTask).toBe(true);

    await agent.recordToReport('Midscene extended API demo', {
      content:
        'Used ai, aiTap, aiInput, aiKeyboardPress, aiAsk, aiBoolean, freeze/unfreeze, evaluateJavaScript.',
    });

    const count = await agent.aiNumber(
      'How many tasks are currently shown in the task board?',
    );
    expect(count).toBe(1);

    const unstableLogs = await agent._unstableLogContent();
    expect(unstableLogs).toBeTruthy();
  });
});

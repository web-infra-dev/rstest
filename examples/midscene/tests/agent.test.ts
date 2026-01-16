import { describe, expect, it } from '@rstest/core';
import { agent } from '@rstest/midscene';

describe('@rstest/midscene advanced API demo', () => {
  it('can use extended Midscene APIs in one workflow', async () => {
    const root = document.createElement('section');
    root.id = 'midscene-demo';
    root.style.padding = '20px';
    root.style.maxWidth = '640px';
    root.style.border = '2px solid #2f855a';
    root.style.borderRadius = '12px';
    root.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';

    const title = document.createElement('h1');
    title.textContent = 'Task board';
    title.style.margin = '0 0 12px';

    const hint = document.createElement('p');
    hint.textContent = 'Type a task title and click Add task';
    hint.style.margin = '0 0 10px';

    const input = document.createElement('input');
    input.id = 'task-title';
    input.type = 'text';
    input.placeholder = 'Task title';
    input.style.padding = '10px 12px';
    input.style.width = '260px';
    input.style.marginRight = '8px';

    const addButton = document.createElement('button');
    addButton.id = 'add-task';
    addButton.textContent = 'Add task';
    addButton.style.padding = '10px 14px';

    const status = document.createElement('p');
    status.id = 'status';
    status.textContent = '0 tasks';
    status.style.margin = '14px 0 8px';

    const list = document.createElement('ul');
    list.id = 'task-list';
    list.style.paddingLeft = '20px';

    const sharedWindow = window as typeof window & { __taskCount?: number };
    sharedWindow.__taskCount = 0;

    const addTask = () => {
      const value = input.value.trim();
      if (!value) {
        return;
      }
      const item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
      input.value = '';
      sharedWindow.__taskCount = list.children.length;
      status.textContent = `${sharedWindow.__taskCount} tasks`;
    };

    addButton.addEventListener('click', addTask);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        addTask();
      }
    });

    root.append(title, hint, input, addButton, status, list);
    document.body.appendChild(root);

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

    const evalResult = (await agent.evaluateJavaScript(`
      (() => {
        return {
          count: (window).__taskCount || 0,
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

    const unstableLogs = await agent._unstableLogContent();
    expect(unstableLogs).toBeTruthy();

    document.body.removeChild(root);
  });
});

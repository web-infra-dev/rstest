import { page } from '@rstest/browser';
import { expect, test } from '@rstest/core';

function createCounter(initial = 0) {
  let count = initial;

  const container = document.createElement('div');
  const display = document.createElement('p');
  const incBtn = document.createElement('button');

  display.textContent = `Count: ${count}`;
  incBtn.textContent = 'Increment';
  incBtn.id = 'inc-btn';

  incBtn.addEventListener('click', () => {
    count++;
    display.textContent = `Count: ${count}`;
  });

  container.append(display, incBtn);
  return container;
}

test('locator + expect.element proxy works', async ({ onTestFinished }) => {
  const container = document.createElement('div');
  document.body.append(container);
  onTestFinished(() => container.remove());
  container.appendChild(createCounter(5));

  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Name';

  const emailInput = document.createElement('input');
  emailInput.placeholder = 'Email';

  container.append(nameInput, emailInput);

  const sections = document.createElement('div');
  sections.innerHTML = `
    <section>
      <h2>Home</h2>
      <button>Save</button>
    </section>
    <section>
      <h2>Profile</h2>
      <button>Save</button>
    </section>
  `;
  container.append(sections);

  await expect.element(page.getByText('Count: 5')).toBeVisible();
  await page.getByRole('button', { name: 'Increment' }).click();
  await expect.element(page.getByText('Count: 6')).toBeVisible();
  await expect.element(page.getByText('Count: 6')).toHaveText('Count: 6');
  await expect
    .element(page.getByRole('button', { name: 'Increment' }))
    .toHaveId('inc-btn');

  await page.getByPlaceholder('Name').fill('Alice');
  await expect.element(page.getByPlaceholder('Name')).toHaveValue('Alice');

  await page.getByPlaceholder('Email').fill('a@b.com');
  await expect.element(page.getByPlaceholder('Email')).toHaveValue('a@b.com');

  // filter({ has })
  const profileSave = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Profile' }) })
    .getByRole('button', { name: 'Save' });
  await expect.element(profileSave).toHaveCount(1, { timeout: 1000 });

  const draftItems = document.createElement('ul');
  draftItems.innerHTML = `
    <li><span>Published</span></li>
    <li><span>Draft</span></li>
    <li><span>Draft</span><span>Locked</span></li>
  `;
  container.append(draftItems);
  await expect
    .element(page.locator('li').filter({ hasNotText: 'Draft' }))
    .toHaveCount(1);
  await expect
    .element(page.locator('li').filter({ hasNot: page.getByText('Locked') }))
    .toHaveCount(2);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'agree';

  const label = document.createElement('label');
  label.htmlFor = 'agree';
  label.textContent = 'Agree';

  container.append(checkbox, label);

  await expect.element(page.getByLabel('Agree')).toBeUnchecked();
  await page.getByLabel('Agree').check();
  await expect.element(page.getByLabel('Agree')).toBeChecked();
  await expect.element(page.getByLabel('Agree')).not.toBeUnchecked();
  await page.getByLabel('Agree').uncheck();
  await expect.element(page.getByLabel('Agree')).toBeUnchecked();
  await expect.element(page.getByLabel('Agree')).not.toBeChecked();

  await page.getByLabel('Agree').focus();
  await expect.element(page.getByLabel('Agree')).toBeFocused();

  // selectOption
  const selectLabel = document.createElement('label');
  selectLabel.htmlFor = 'choice';
  selectLabel.textContent = 'Choice';

  const select = document.createElement('select');
  select.id = 'choice';
  select.innerHTML = `
    <option value="a">A</option>
    <option value="b">B</option>
  `;
  container.append(selectLabel, select);
  await page.getByLabel('Choice').selectOption('b');
  await expect.element(page.getByLabel('Choice')).toHaveValue('b');

  // toBeAttached/toBeDetached
  const later = document.createElement('div');
  later.id = 'later';
  setTimeout(() => container.appendChild(later), 50);
  await expect.element(page.locator('#later')).toBeAttached();
  later.remove();
  await expect.element(page.locator('#later')).toBeDetached();

  // dispatchEvent
  const evBtn = document.createElement('button');
  evBtn.textContent = 'Event';
  evBtn.addEventListener('custom', () => {
    evBtn.textContent = 'Event:OK';
  });
  container.appendChild(evBtn);
  await page.getByRole('button', { name: 'Event' }).dispatchEvent('custom');
  await expect.element(page.getByText('Event:OK')).toBeVisible();

  // and/or composition
  const incBtn = page.getByRole('button', { name: 'Increment' });
  await expect.element(incBtn.and(page.locator('#inc-btn'))).toHaveCount(1);
  await expect
    .element(page.getByPlaceholder('Name').or(page.getByPlaceholder('Email')))
    .toHaveCount(2);
});

test('supports native DOM references in detached nodes, shadow DOM, and SVG', async () => {
  const host = document.createElement('div');
  const button = document.createElement('button');
  button.textContent = 'Shadow action';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(button);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-label', 'Icon');
  host.appendChild(svg);
  const locator = page.elementLocator(button);
  await expect.element(locator).toBeDetached();

  setTimeout(() => document.body.appendChild(host), 50);
  await expect.element(button).toBeVisible({ timeout: 1000 });
  await expect
    .element(page.elementLocator(host).getByRole('button'))
    .toHaveText('Shadow action');
  await expect
    .element(page.locator('body').filter({ has: locator }))
    .toHaveCount(1);
  await expect.element(svg).toHaveAttribute('aria-label', 'Icon');

  button.onclick = () => {
    button.textContent = 'Clicked original';
  };
  await locator.click();
  await expect.element(button).toHaveText('Clicked original');

  host.remove();
  await expect.element(locator).toBeDetached();
});

test('rejects invalid elements and elements from another document', () => {
  for (const value of [null, document, document.createTextNode('text'), {}]) {
    expect(() => Reflect.apply(page.elementLocator, page, [value])).toThrow(
      /DOM Element from the current test document/,
    );
    expect(() => Reflect.apply(expect.element, expect, [value])).toThrow(
      /DOM Element from the current test document/,
    );
  }
  const foreign = document.implementation
    .createHTMLDocument()
    .createElement('button');
  expect(() => page.elementLocator(foreign)).toThrow(/current test document/);
  expect(() => expect.element(foreign)).toThrow(/current test document/);

  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const foreignFrameElement = iframe.contentDocument?.createElement('button');
  if (!foreignFrameElement) throw new Error('Expected a same-origin iframe');
  expect(() => page.elementLocator(foreignFrameElement)).toThrow(
    /current test document/,
  );
  expect(() => expect.element(foreignFrameElement)).toThrow(
    /current test document/,
  );
  iframe.remove();
});

test('asserts multi-select values with strings, regexes, and retries', async () => {
  const select = document.createElement('select');
  select.id = 'language-values';
  select.multiple = true;
  const javascript = new Option('JavaScript', 'javascript');
  select.append(
    new Option('TypeScript', 'typescript'),
    javascript,
    new Option('Rust', 'rust'),
  );
  document.body.appendChild(select);
  const locator = page.locator('#language-values');

  await expect.element(locator).toHaveValues([]);
  await locator.selectOption(['rust', 'typescript']);
  await expect.element(locator).toHaveValues(['typescript', 'rust']);
  await expect.element(locator).toHaveValues([/^TYPESCRIPT$/i, 'rust']);
  await expect.element(locator).not.toHaveValues(['javascript']);
  await expect(
    expect
      .element(locator)
      .toHaveValues(['rust', 'typescript'], { timeout: 50 }),
  ).rejects.toThrow();

  setTimeout(() => {
    javascript.selected = true;
  }, 100);
  await expect
    .element(locator)
    .toHaveValues(['typescript', /^java/, 'rust'], { timeout: 1000 });

  await locator.selectOption([]);
  await expect.element(locator).toHaveValues([]);
  select.remove();
});

test('pressSequentially types text one key event at a time', async () => {
  const input = document.createElement('input');
  input.placeholder = 'Search query';
  const keys: string[] = [];
  input.addEventListener('keydown', (event) => keys.push(event.key));
  document.body.appendChild(input);

  await page.getByPlaceholder('Search query').pressSequentially('rs test');

  await expect
    .element(page.getByPlaceholder('Search query'))
    .toHaveValue('rs test');
  expect(keys).toEqual(['r', 's', ' ', 't', 'e', 's', 't']);
  input.remove();
});

test('dragTo moves a draggable element to a drop target', async () => {
  const source = document.createElement('div');
  source.id = 'drag-source';
  source.textContent = 'Drag item';
  source.draggable = true;
  const target = document.createElement('div');
  target.id = 'drop-target';
  target.textContent = 'Drop here';
  target.style.width = '150px';
  target.style.height = '80px';
  target.addEventListener('dragover', (event) => event.preventDefault());
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    target.textContent = 'Dropped';
  });
  document.body.append(source, target);

  await page.locator('#drag-source').dragTo(page.locator('#drop-target'));
  await expect.element(page.locator('#drop-target')).toHaveText('Dropped');
  source.remove();
  target.remove();
});

test('asserts accessible role, name, and description', async () => {
  const description = document.createElement('p');
  description.id = 'save-description';
  description.textContent = 'Stores your changes';
  const button = document.createElement('button');
  button.id = 'accessible-save';
  button.setAttribute('aria-label', 'Save changes');
  button.setAttribute('aria-describedby', description.id);
  document.body.append(button, description);

  const locator = page.locator('#accessible-save');
  await expect.element(locator).toHaveRole('button');
  await expect.element(locator).toHaveAccessibleName('Save changes');
  await expect.element(locator).toHaveAccessibleName(/^Save/);
  await expect
    .element(locator)
    .toHaveAccessibleDescription('Stores your changes');
  await expect.element(locator).toHaveAccessibleDescription(/your changes$/);
  await expect.element(locator).not.toHaveRole('link');
  await expect.element(locator).not.toHaveAccessibleName('Delete changes');
  await expect
    .element(locator)
    .not.toHaveAccessibleDescription('Deletes changes');
  button.remove();
  description.remove();
});

test('counts a retried element assertion once', async () => {
  expect.assertions(1);

  const delayed = document.createElement('div');
  delayed.id = 'delayed-assertion-count';
  setTimeout(() => document.body.appendChild(delayed), 50);

  await expect.element(page.locator('#delayed-assertion-count')).toBeAttached();
  delayed.remove();
});

test.concurrent(
  'supports element assertions on context expect',
  async ({ expect: contextExpect }) => {
    contextExpect.hasAssertions();

    const target = document.createElement('div');
    target.textContent = 'Context element assertion';
    document.body.appendChild(target);

    await contextExpect
      .element(page.getByText('Context element assertion'))
      .toBeVisible();
    target.remove();
  },
);

test('keyboard presses use the current focus and native events', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  const events: {
    type: string;
    key: string;
    shift: boolean;
    trusted: boolean;
  }[] = [];
  for (const type of ['keydown', 'keyup'] as const) {
    input.addEventListener(type, (event) => {
      events.push({
        type,
        key: event.key,
        shift: event.shiftKey,
        trusted: event.isTrusted,
      });
    });
  }
  try {
    await page.elementLocator(input).focus();
    await page.keyboard.press('Shift+A', { delay: 5 });
    await page.keyboard.press('b');
    await expect.element(input).toHaveValue('Ab');
    expect(events).toEqual([
      { type: 'keydown', key: 'Shift', shift: true, trusted: true },
      { type: 'keydown', key: 'A', shift: true, trusted: true },
      { type: 'keyup', key: 'A', shift: true, trusted: true },
      { type: 'keyup', key: 'Shift', shift: false, trusted: true },
      { type: 'keydown', key: 'b', shift: false, trusted: true },
      { type: 'keyup', key: 'b', shift: false, trusted: true },
    ]);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await expect.element(input).toHaveValue('');
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('y');
    await expect.element(input).toHaveValue('yx');
  } finally {
    input.remove();
  }
});

test('keyboard tab follows browser focus order in both directions', async () => {
  const container = document.createElement('div');
  container.innerHTML =
    '<input aria-label="First"><input disabled><input aria-label="Second"><button>Last</button>';
  document.body.append(container);
  const first = page.elementLocator(container).getByLabel('First');
  const second = page.elementLocator(container).getByLabel('Second');
  const last = page.elementLocator(container).getByRole('button');
  try {
    await first.focus();
    await page.keyboard.tab();
    await expect.element(second).toBeFocused();
    await page.keyboard.tab();
    await expect.element(last).toBeFocused();
    await page.keyboard.tab({ shift: true });
    await expect.element(second).toBeFocused();
    await page.keyboard.tab({ shift: true });
    await expect.element(first).toBeFocused();
    await page.keyboard.press('a');
    await expect.element(first).toHaveValue('a');
  } finally {
    container.remove();
  }
});

test('keyboard can unblock a locator waiting for actionability', async () => {
  const input = document.createElement('input');
  const button = document.createElement('button');
  button.disabled = true;
  button.textContent = 'Continue';
  let clicked = false;
  button.onclick = () => {
    clicked = true;
  };
  input.onkeydown = (event) => {
    if (event.key === 'Escape') {
      button.disabled = false;
    }
  };
  document.body.append(input, button);
  try {
    await page.elementLocator(input).focus();
    await Promise.all([
      page.elementLocator(button).click({ timeout: 1000 }),
      page.keyboard.press('Escape'),
    ]);
    expect(clicked).toBe(true);
  } finally {
    input.remove();
    button.remove();
  }
});

test('headed keyboard routes input to the runner after the container takes focus', async () => {
  if (window.parent === window) {
    return;
  }
  const input = document.createElement('input');
  const outside = window.parent.document.createElement('input');
  document.body.append(input);
  window.parent.document.body.append(outside);
  let receivedEscape = false;
  const onKeyDown = (event: KeyboardEvent) => {
    receivedEscape = event.key === 'Escape' && event.isTrusted;
  };
  document.addEventListener('keydown', onKeyDown);
  try {
    await page.elementLocator(input).focus();
    await page.keyboard.press('a');
    outside.focus();
    expect(window.parent.document.activeElement).toBe(outside);
    await page.keyboard.press('Escape');
    expect(receivedEscape).toBe(true);
    await expect.element(input).toHaveValue('a');
    expect(outside.value).toBe('');
  } finally {
    document.removeEventListener('keydown', onKeyDown);
    input.remove();
    outside.remove();
  }
});

test('supports locator filter({ visible }), locator(selector, options), count(), all(), clear(options), dispatchEvent(options), and selectOption alignment', async ({
  onTestFinished,
}) => {
  const root = document.createElement('div');
  root.innerHTML = `
    <ul id="visibility-list">
      <li class="row visible-row"><span>Visible One</span></li>
      <li class="row hidden-row" style="display: none"><span>Hidden Two</span></li>
      <li class="row visible-row"><span>Visible Three</span><em class="tag">Pinned</em></li>
    </ul>
    <input id="clear-input" value="initial" />
    <button id="event-target">Dispatch</button>
    <select id="multi-select" multiple>
      <option value="ts">TypeScript</option>
      <option value="rs">Rust</option>
      <option value="go">Go</option>
    </select>
  `;
  document.body.append(root);
  onTestFinished(() => root.remove());

  const rows = page.locator('#visibility-list li');
  expect(await rows.count()).toBe(3);
  expect(await rows.filter({ visible: true }).count()).toBe(2);
  expect(await rows.filter({ visible: false }).count()).toBe(1);

  const visibleLocators = await rows.filter({ visible: true }).all();
  expect(visibleLocators).toHaveLength(2);
  await expect.element(visibleLocators[0]!).toHaveText('Visible One');
  await expect.element(visibleLocators[1]!).toContainText('Visible Three');

  const pinnedRow = page.locator('#visibility-list li', {
    has: page.locator('.tag'),
    hasText: 'Visible Three',
  });
  await expect.element(pinnedRow).toHaveCount(1);

  const clearInput = page.locator('#clear-input');
  await clearInput.clear({ timeout: 1000 });
  await expect.element(clearInput).toHaveValue('');

  const eventBtn = root.querySelector('#event-target') as HTMLButtonElement;
  let receivedEvent: { bubbles: boolean; cancelable: boolean } | undefined;
  eventBtn.addEventListener('ping', (event) => {
    receivedEvent = {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
    };
  });
  await page
    .locator('#event-target')
    .dispatchEvent(
      'ping',
      { bubbles: true, cancelable: true },
      { timeout: 1000 },
    );
  expect(receivedEvent).toEqual({ bubbles: true, cancelable: true });
  await expect(
    page
      .locator('#missing-event-target')
      .dispatchEvent('ping', undefined, { timeout: 50 }),
  ).rejects.toThrow(/50ms/);

  const select = page.locator('#multi-select');
  expect(await select.selectOption({ label: 'Rust' })).toEqual(['rs']);
  expect(await select.selectOption([{ index: 0 }, { value: 'go' }])).toEqual([
    'ts',
    'go',
  ]);
  await expect.element(select).toHaveValues(['ts', 'go']);
  expect(await select.selectOption(null)).toEqual([]);
  await expect.element(select).toHaveValues([]);

  const optionEl = root.querySelector('option')!;
  await expect(
    select.selectOption(optionEl as unknown as string),
  ).rejects.toThrow(/Locator\.selectOption\(\)/);
  await expect(select.selectOption({} as unknown as string)).rejects.toThrow(
    /Locator\.selectOption\(\)/,
  );
});

test('supports toContainClass, array matchers, ignoreCase, useInnerText, attribute overloads, and state options', async ({
  onTestFinished,
}) => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="card" class="card featured primary" data-theme="DarkMode">Card</div>
    <ul id="items">
      <li class="item alpha">First <span style="display: none">Hidden</span></li>
      <li class="item beta">Second</li>
    </ul>
    <input id="indet" type="checkbox" />
    <input id="ro" type="text" readonly value="locked" />
    <button id="disabled-btn" disabled aria-label="Save Draft" aria-describedby="desc">Save</button>
    <p id="desc">Stores Current Draft</p>
    <div id="hidden-box" style="display: none">Secret</div>
  `;
  document.body.append(root);
  onTestFinished(() => root.remove());

  const checkbox = root.querySelector('#indet') as HTMLInputElement;
  checkbox.indeterminate = true;

  // toContainClass (single, multi-token, array, negation, RegExp rejection)
  await expect.element(page.locator('#card')).toContainClass('featured');
  await expect.element(page.locator('#card')).toContainClass('primary card');
  await expect.element(page.locator('#card')).not.toContainClass('missing');
  await expect
    .element(page.locator('#items li'))
    .toContainClass(['alpha', 'beta']);
  await expect(
    expect
      .element(page.locator('#card'))
      .toContainClass(/featured/ as unknown as string),
  ).rejects.toThrow(/cannot be a RegExp value/);

  // toHaveClass array
  await expect
    .element(page.locator('#items li'))
    .toHaveClass(['item alpha', /^item beta$/]);

  // toHaveText & toContainText array + ignoreCase + useInnerText
  const items = page.locator('#items li');
  await expect
    .element(items)
    .toHaveText(['first', 'second'], { ignoreCase: true, useInnerText: true });
  await expect
    .element(items)
    .toContainText(['FIRST', 'SEC'], { ignoreCase: true, useInnerText: true });
  await expect
    .element(items.first())
    .toHaveText('First Hidden', { useInnerText: false });

  // toHaveAttribute 2-arg options overload + ignoreCase
  await expect
    .element(page.locator('#disabled-btn'))
    .toHaveAttribute('disabled', { timeout: 1000 });
  await expect
    .element(page.locator('#card'))
    .toHaveAttribute('data-theme', 'darkmode', {
      ignoreCase: true,
      timeout: 1000,
    });

  // toHaveAccessibleName / toHaveAccessibleDescription ignoreCase
  await expect
    .element(page.locator('#disabled-btn'))
    .toHaveAccessibleName('save draft', { ignoreCase: true });
  await expect
    .element(page.locator('#disabled-btn'))
    .toHaveAccessibleDescription('stores current draft', { ignoreCase: true });

  // Boolean state options & toBeChecked({ indeterminate, checked })
  await expect
    .element(page.locator('#hidden-box'))
    .toBeVisible({ visible: false });
  await expect
    .element(page.locator('#does-not-exist'))
    .toBeAttached({ attached: false });
  await expect
    .element(page.locator('#disabled-btn'))
    .toBeEnabled({ enabled: false });
  await expect.element(page.locator('#ro')).toBeEditable({ editable: false });
  await expect
    .element(page.locator('#indet'))
    .toBeChecked({ indeterminate: true });
  checkbox.indeterminate = false;
  checkbox.checked = false;
  await expect.element(page.locator('#indet')).toBeChecked({ checked: false });
});

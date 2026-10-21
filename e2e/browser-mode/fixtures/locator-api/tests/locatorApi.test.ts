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

test('locator + expect.element proxy works', async () => {
  document.body.appendChild(createCounter(5));

  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Name';

  const emailInput = document.createElement('input');
  emailInput.placeholder = 'Email';

  document.body.append(nameInput, emailInput);

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
  document.body.append(sections);

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
  document.body.append(draftItems);
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

  document.body.append(checkbox, label);

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
  document.body.append(selectLabel, select);
  await page.getByLabel('Choice').selectOption('b');
  await expect.element(page.getByLabel('Choice')).toHaveValue('b');

  // toBeAttached/toBeDetached
  const later = document.createElement('div');
  later.id = 'later';
  setTimeout(() => document.body.appendChild(later), 50);
  await expect.element(page.locator('#later')).toBeAttached();
  later.remove();
  await expect.element(page.locator('#later')).toBeDetached();

  // dispatchEvent
  const evBtn = document.createElement('button');
  evBtn.textContent = 'Event';
  evBtn.addEventListener('custom', () => {
    evBtn.textContent = 'Event:OK';
  });
  document.body.appendChild(evBtn);
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

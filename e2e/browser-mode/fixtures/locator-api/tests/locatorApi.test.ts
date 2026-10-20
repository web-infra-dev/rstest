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

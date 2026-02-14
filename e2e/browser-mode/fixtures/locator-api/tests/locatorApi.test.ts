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

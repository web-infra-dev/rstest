import { describe, expect, it } from '@rstest/core';

describe('Project B - List Tests', () => {
  it('creates an unordered list', () => {
    const ul = document.createElement('ul');
    ul.id = 'list-b';
    document.body.appendChild(ul);
    expect(document.getElementById('list-b')).toBe(ul);
  });

  it('adds list items', () => {
    const ul = document.createElement('ul');
    const li1 = document.createElement('li');
    li1.textContent = 'Item 1';
    const li2 = document.createElement('li');
    li2.textContent = 'Item 2';
    ul.appendChild(li1);
    ul.appendChild(li2);
    expect(ul.children.length).toBe(2);
  });
});

describe('Project B - Table Tests', () => {
  it('creates a table with rows', () => {
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.textContent = 'Cell B';
    row.appendChild(cell);
    table.appendChild(row);
    expect(table.rows.length).toBe(1);
  });
});

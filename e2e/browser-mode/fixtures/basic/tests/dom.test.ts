import { describe, expect, it } from '@rstest/core';

describe('DOM operations', () => {
  it('should create elements correctly', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello Browser';
    document.body.appendChild(div);

    expect(document.body.textContent).toContain('Hello Browser');

    // Cleanup
    document.body.removeChild(div);
  });

  it('should manipulate element attributes', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'value');
    el.id = 'test-id';
    el.className = 'test-class';

    expect(el.getAttribute('data-test')).toBe('value');
    expect(el.id).toBe('test-id');
    expect(el.className).toBe('test-class');
  });

  it('should handle child elements', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('span');

    child1.textContent = 'Child 1';
    child2.textContent = 'Child 2';

    parent.appendChild(child1);
    parent.appendChild(child2);

    expect(parent.children.length).toBe(2);
    expect(parent.children[0]?.textContent).toBe('Child 1');
    expect(parent.children[1]?.textContent).toBe('Child 2');

    parent.removeChild(child1);
    expect(parent.children.length).toBe(1);
  });

  it('should handle innerHTML and textContent', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>Inner HTML</span>';

    expect(div.innerHTML).toBe('<span>Inner HTML</span>');
    expect(div.textContent).toBe('Inner HTML');

    div.textContent = 'Plain text';
    expect(div.innerHTML).toBe('Plain text');
  });

  it('should query elements correctly', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="item" id="first">First</div>
      <div class="item" id="second">Second</div>
      <span class="other">Other</span>
    `;
    document.body.appendChild(container);

    expect(document.getElementById('first')?.textContent).toBe('First');
    expect(document.querySelector('.item')?.id).toBe('first');
    expect(document.querySelectorAll('.item').length).toBe(2);

    // Cleanup
    document.body.removeChild(container);
  });
});

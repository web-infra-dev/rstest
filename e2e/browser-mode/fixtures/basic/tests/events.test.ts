import { describe, expect, it } from '@rstest/core';

describe('Event handling', () => {
  it('should handle click events', () => {
    let clicked = false;
    const button = document.createElement('button');
    button.addEventListener('click', () => {
      clicked = true;
    });
    document.body.appendChild(button);

    button.click();
    expect(clicked).toBe(true);

    // Cleanup
    document.body.removeChild(button);
  });

  it('should handle multiple event listeners', () => {
    const events: string[] = [];
    const button = document.createElement('button');

    button.addEventListener('click', () => events.push('listener1'));
    button.addEventListener('click', () => events.push('listener2'));

    button.click();

    expect(events).toEqual(['listener1', 'listener2']);
  });

  it('should remove event listeners', () => {
    let count = 0;
    const button = document.createElement('button');
    const handler = () => {
      count++;
    };

    button.addEventListener('click', handler);
    button.click();
    expect(count).toBe(1);

    button.removeEventListener('click', handler);
    button.click();
    expect(count).toBe(1);
  });

  it('should handle keyboard events', () => {
    const events: string[] = [];
    const input = document.createElement('input');

    input.addEventListener('keydown', (e) => {
      events.push(`keydown:${e.key}`);
    });

    input.addEventListener('keyup', (e) => {
      events.push(`keyup:${e.key}`);
    });

    document.body.appendChild(input);

    const keydownEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    const keyupEvent = new KeyboardEvent('keyup', { key: 'Enter' });

    input.dispatchEvent(keydownEvent);
    input.dispatchEvent(keyupEvent);

    expect(events).toEqual(['keydown:Enter', 'keyup:Enter']);

    // Cleanup
    document.body.removeChild(input);
  });

  it('should handle mouse events', () => {
    const events: string[] = [];
    const div = document.createElement('div');

    div.addEventListener('mouseenter', () => events.push('mouseenter'));
    div.addEventListener('mouseleave', () => events.push('mouseleave'));

    div.dispatchEvent(new MouseEvent('mouseenter'));
    div.dispatchEvent(new MouseEvent('mouseleave'));

    expect(events).toEqual(['mouseenter', 'mouseleave']);
  });

  it('should handle event bubbling', () => {
    const events: string[] = [];
    const parent = document.createElement('div');
    const child = document.createElement('button');

    parent.appendChild(child);
    document.body.appendChild(parent);

    parent.addEventListener('click', () => events.push('parent'));
    child.addEventListener('click', () => events.push('child'));

    child.click();

    expect(events).toEqual(['child', 'parent']);

    // Cleanup
    document.body.removeChild(parent);
  });

  it('should stop propagation', () => {
    const events: string[] = [];
    const parent = document.createElement('div');
    const child = document.createElement('button');

    parent.appendChild(child);
    document.body.appendChild(parent);

    parent.addEventListener('click', () => events.push('parent'));
    child.addEventListener('click', (e) => {
      e.stopPropagation();
      events.push('child');
    });

    child.click();

    expect(events).toEqual(['child']);

    // Cleanup
    document.body.removeChild(parent);
  });
});

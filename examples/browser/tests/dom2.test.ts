import { describe, expect, it } from '@rstest/core';

const sleep = (ms: number) =>
  new Promise((res) => globalThis.setTimeout(res, ms));

describe('DOM Manipulation', () => {
  describe('Element Creation', () => {
    it('creates a div element', () => {
      const div = document.createElement('div');
      expect(div.tagName).toBe('DIV');
    });

    it('creates a span element', () => {
      const span = document.createElement('span');
      expect(span.tagName).toBe('SPAN');
    });

    describe('With Attributes', () => {
      it('sets id attribute', () => {
        const el = document.createElement('div');
        el.id = 'test-id';
        expect(el.id).toBe('test-id');
      });

      it('sets class attribute', () => {
        const el = document.createElement('div');
        el.className = 'test-class';
        expect(el.className).toBe('test-class');
      });

      describe('Data Attributes', () => {
        it('sets data-* attribute', () => {
          const el = document.createElement('div');
          el.dataset.testValue = 'hello';
          expect(el.dataset.testValue).toBe('hello');
        });

        it('reads data-* attribute', () => {
          const el = document.createElement('div');
          el.setAttribute('data-custom', 'world');
          expect(el.dataset.custom).toBe('world');
        });
      });
    });
  });

  describe('Event Handling', () => {
    it('handles click events', () => {
      let clicked = false;
      const button = document.createElement('button');
      button.addEventListener('click', () => {
        clicked = true;
      });
      button.click();
      expect(clicked).toBe(true);
    });

    describe('Mouse Events', () => {
      it('handles mouseenter', () => {
        let entered = false;
        const div = document.createElement('div');
        div.addEventListener('mouseenter', () => {
          entered = true;
        });
        div.dispatchEvent(new MouseEvent('mouseenter'));
        expect(entered).toBe(true);
      });

      it('handles mouseleave', () => {
        let left = false;
        const div = document.createElement('div');
        div.addEventListener('mouseleave', () => {
          left = true;
        });
        div.dispatchEvent(new MouseEvent('mouseleave'));
        expect(left).toBe(true);
      });
    });

    describe('Keyboard Events', () => {
      it('handles keydown', () => {
        let keyPressed = '';
        const input = document.createElement('input');
        input.addEventListener('keydown', (e) => {
          keyPressed = e.key;
        });
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(keyPressed).toBe('Enter');
      });

      describe('Special Keys', () => {
        it('handles Escape key', () => {
          let escaped = false;
          const input = document.createElement('input');
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') escaped = true;
          });
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          expect(escaped).toBe(true);
        });

        it('handles Tab key', () => {
          let tabbed = false;
          const input = document.createElement('input');
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') tabbed = true;
          });
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
          expect(tabbed).toBe(true);
        });
      });
    });
  });

  describe('Async Operations', () => {
    it('waits for timeout', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    describe('Animation Frame', () => {
      it('requests animation frame', async () => {
        let called = false;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            called = true;
            resolve();
          });
        });
        expect(called).toBe(true);
      });
    });
  });
});

describe('Counter Component', () => {
  it('increments text content when clicked', async () => {
    const title = document.createElement('h1');
    title.textContent = 'DOM 2';
    document.body.appendChild(title);

    const button = document.createElement('button');
    button.id = 'counter';
    button.textContent = '0';

    button.addEventListener('click', () => {
      button.textContent = String(Number(button.textContent) + 1);
    });

    document.body.appendChild(button);

    button.click();
    expect(button.textContent).toBe('1');

    button.click();
    expect(button.textContent).toBe('2');

    await sleep(100);
    button.click();
    expect(button.textContent).toBe('3');
  });
});

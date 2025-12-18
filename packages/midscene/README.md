# @rstest/midscene

Midscene integration for Rstest browser mode. This package provides a Playwright-like API for controlling the browser from within rstest browser mode tests.

## Installation

```bash
pnpm add @rstest/midscene
```

## Usage

```ts
import { test } from '@rstest/core';
import { frame } from '@rstest/midscene';

test('click a button', async () => {
  await frame.click('button#submit');
});

test('type in input', async () => {
  await frame.click('input#name');
  await frame.keyboard.type('Hello, world!');
  await frame.keyboard.press('Enter');
});

test('take screenshot', async () => {
  const screenshot = await frame.screenshot();
  // screenshot is a base64-encoded string
});
```

## API

### `frame.click(selector, options?)`

Click an element by CSS selector.

### `frame.mouse.click(x, y, options?)`

Click at the specified coordinates (relative to iframe).

### `frame.keyboard.type(text, delay?)`

Type text into the focused element.

### `frame.keyboard.press(key, delay?)`

Press a key (e.g., 'Enter', 'Tab', 'Control+A').

### `frame.screenshot(options?)`

Take a screenshot of the iframe. Returns a base64-encoded string.

### `frame.evaluate(expression)`

Evaluate JavaScript in the frame context.

## License

MIT

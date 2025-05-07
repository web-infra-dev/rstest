import { expect, it } from '@rstest/core';
import { render } from '../src/index.server';

it('ssr render', () => {
  expect(render()).toMatchInlineSnapshot(
    `"<div class="content"><h1>Rsbuild with React</h1><p>Start building amazing things with Rsbuild.</p></div>"`,
  );
});

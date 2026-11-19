import { expect, it } from '@rstest/core';

it('loads the runner source map', async () => {
  const runner = Array.from(document.scripts).find((script) =>
    /\/runner(?:-\d+)?\.js$/.test(script.src),
  );
  expect(runner).toBeDefined();
  const response = await fetch(`${runner!.src}.map`);
  const map = await response.json();
  expect(map.mappings.length).toBeGreaterThan(0);
  console.log(
    `Runner map embeds sources: ${Boolean(map.sourcesContent?.length)}`,
  );
});

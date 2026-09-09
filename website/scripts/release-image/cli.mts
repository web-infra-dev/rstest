import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomBackground, renderBanner, renderOgImage } from './render.mts';

const { values } = parseArgs({
  options: {
    version: { type: 'string', short: 'v' },
    description: { type: 'string' },
    'out-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.version) {
  console.log(`Usage: pnpm gen:release --version <ver> [options]

Generates both release images at once, sharing one random gradient so the
banner and og card of a release match:
  - rstest-banner-v<ver>.png    4096x1152 in-page blog banner
  - rstest-og-image-v<ver>.png  2400x1260 social card

Options:
  --version, -v       Release version, e.g. 0.11 (required)
  --description       Tagline rendered below the version on the og card
  --out-dir           Output directory (default: cwd)
  --help, -h          Show this help

og images are committed to rstackjs/rstack-design-resources under rstest/ so the
assets.rspack.rs CDN can serve them (rspress.config.ts wires og:image per blog
route). Banners are referenced by a site-relative path from the blog. Compress
both with TinyPNG before committing.`);
  process.exit(values.help ? 0 : 1);
}

const version = values.version;
const versionSlug = version.replace(/\./g, '-');
const dir = path.resolve(values['out-dir'] ?? '.');

// One gradient for both images so the release's banner and og card match.
const background = randomBackground();
const [banner, og] = await Promise.all([
  renderBanner({ version, background }),
  renderOgImage({ version, description: values.description, background }),
]);

await mkdir(dir, { recursive: true });
for (const [name, png] of [
  [`rstest-banner-v${versionSlug}.png`, banner],
  [`rstest-og-image-v${versionSlug}.png`, og],
] as const) {
  const outPath = path.join(dir, name);
  await writeFile(outPath, png);
  console.log(`Wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
}

console.log(
  'Tip: compress the PNGs before committing — typically drops each file to ~1/4 the size with no visible loss.',
);
console.log('  https://tinypng.com (or Squoosh / ImageOptim)');

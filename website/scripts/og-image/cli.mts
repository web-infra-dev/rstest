import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { renderOgImage } from './render.mts';

const { values } = parseArgs({
  options: {
    version: { type: 'string', short: 'v' },
    description: { type: 'string' },
    out: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.version) {
  console.log(`Usage: pnpm gen:og --version <ver> [options]

Options:
  --version, -v       Release version, e.g. 0.5 (required)
  --description       Optional tagline rendered below the version
  --out, -o           Output PNG path
                      (default: rstest-og-image-v<ver>.png in cwd)
  --help, -h          Show this help

After generating, commit the PNG to rstackjs/rstack-design-resources
under rstest/assets/ so the assets.rspack.rs CDN can serve it.`);
  process.exit(values.help ? 0 : 1);
}

const versionSlug = values.version.replace(/\./g, '-');
const outPath = path.resolve(
  values.out ?? `rstest-og-image-v${versionSlug}.png`,
);

const png = await renderOgImage({
  version: values.version,
  description: values.description,
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, png);

console.log(`Wrote ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
console.log(
  'Tip: compress the PNG before committing — typically drops the file to ~1/4 the size with no visible loss.',
);
console.log('  https://tinypng.com (or Squoosh / ImageOptim)');

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import sharp from 'sharp';
import {
  buildTemplate,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type TemplateOptions,
} from './template.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, 'assets/fonts');

const LOGO_URL = 'https://assets.rspack.rs/rstest/rstest-logo.svg';

// Lucide-mirrored icon node markup, normalized to a 24x24 viewBox.
// Sources: lucide-react `circle-check`, `circle-x`, `loader`, `circle-dashed`
// — the same icons rendered by @rstest/browser-ui for pass / fail / running /
// skip status, see packages/browser-ui/src/utils/constants.tsx.
const ICON_PATHS = {
  pass: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  fail: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  running:
    '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  skip: '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
} as const;

type IconKind = keyof typeof ICON_PATHS;

// Hues mirror @rstest/browser-ui status colors (green/amber/red/gray Geist
// family) so the background reads as "test runner status" at first glance.
const ICON_COLORS: Record<IconKind, string> = {
  pass: '#16a34a',
  running: '#d97706',
  fail: '#dc2626',
  skip: '#71717a',
};

const ICON_KINDS: IconKind[] = ['pass', 'running', 'fail', 'skip'];

// The center vignette is baked into the SVG (rather than layered via CSS) so
// satori's `background` shorthand doesn't have to handle a
// `radial-gradient(...), url(...)` layering with data URIs — which it
// doesn't.
function buildBackgroundSvg(width: number, height: number): string {
  // iconSize=70 is the largest value that divides the vertical axis cleanly
  // (rowSpacing = 1.5 * 70 = 105, 630 / 105 = 6 → rows=7 with the last row
  // landing exactly on y=height). Horizontal can't divide cleanly at the
  // same iconSize (1200/105 ≈ 11.43), so cols=12 with colSpacing forced to
  // 1200/11 ≈ 109.09 — a ~4px deviation. The integer constraint for both
  // axes simultaneously only admits iconSize ≤ 20 (GCD(800, 420) = 20),
  // which is too small to read as a test status icon.
  const iconSize = 70;
  const scale = iconSize / 24;
  const rows = 7;
  const cols = 12;
  const rowSpacing = height / (rows - 1);
  const colSpacing = width / (cols - 1);
  const OPACITY_BASE = 0.16;
  const OPACITY_SPREAD = 0.1;

  let icons = '';
  for (let r = 0; r < rows; r++) {
    // Brick pattern: offset by colSpacing/2 (not iconSize/2 — colSpacing is
    // wider), intentionally breaking first/last-column alignment on odd rows.
    const rowOffset = r % 2 === 1 ? colSpacing / 2 : 0;
    const cy = r * rowSpacing;
    for (let c = 0; c < cols; c++) {
      const cx = c * colSpacing + rowOffset;
      if (cx > width + iconSize / 2) continue;
      const kind = ICON_KINDS[Math.floor(Math.random() * ICON_KINDS.length)]!;
      const color = ICON_COLORS[kind];
      // Only `running` (an 8-spoke loader) reads as "spinner caught mid-tick"
      // when rotated. Pass/fail/skip are radially symmetric — rotating them
      // just looks like a wobble.
      const rotation =
        kind === 'running' ? (Math.random() * 360).toFixed(1) : '0';
      const opacity = (
        OPACITY_BASE +
        (Math.random() * 2 - 1) * OPACITY_SPREAD
      ).toFixed(3);
      icons += `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rotation}) scale(${scale.toFixed(3)}) translate(-12 -12)" stroke="${color}" stroke-opacity="${opacity}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${ICON_PATHS[kind]}</g>`;
    }
  }

  const vignette = `<defs><radialGradient id="vig" cx="50%" cy="55%" r="60%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#vig)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${icons}${vignette}</svg>`;
}

function svgToPngDataUrl(svg: string, width: number): string {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
    .render()
    .asPng();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function fetchLogoSvg(): Promise<string> {
  const response = await fetch(LOGO_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch logo from ${LOGO_URL}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

export type RenderOptions = Omit<
  TemplateOptions,
  'logoDataUrl' | 'backgroundDataUrl'
>;

export async function renderOgImage(opts: RenderOptions): Promise<Buffer> {
  const [regular, bold, logoSvg] = await Promise.all([
    readFile(path.join(fontsDir, 'SpaceGrotesk-Regular.ttf')),
    readFile(path.join(fontsDir, 'SpaceGrotesk-Bold.ttf')),
    fetchLogoSvg(),
  ]);

  const tree = buildTemplate({
    ...opts,
    // 512px source stays crisp when the og PNG is rendered at 2x.
    logoDataUrl: svgToPngDataUrl(logoSvg, 512),
    backgroundDataUrl: svgToPngDataUrl(
      buildBackgroundSvg(CANVAS_WIDTH, CANVAS_HEIGHT),
      CANVAS_WIDTH,
    ),
  });

  const svg = await satori(tree, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fonts: [
      { name: 'Space Grotesk', data: regular, weight: 400, style: 'normal' },
      { name: 'Space Grotesk', data: bold, weight: 700, style: 'normal' },
    ],
  });

  // 2x zoom for retina; 2400x1260 fits Twitter/Facebook's ~5MB / 8192px limits.
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 } });

  // Re-encode as 8-bit palette PNG via libimagequant (TinyPNG-style lossy
  // quantization). The resvg truecolor output is ~500 KB; palette mode drops
  // it to ~140 KB with no visible loss on this design (vignette + stroked
  // icons quantize cleanly into 256 colors).
  return sharp(resvg.render().asPng())
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
    .toBuffer();
}

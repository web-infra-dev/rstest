import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import {
  buildTemplate,
  type Layout,
  LAYOUTS,
  type TemplateOptions,
} from './template.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, 'assets/fonts');

const LOGO_URL = 'https://assets.rspack.rs/rstest/rstest-logo.svg';

// Hues seeded from the rstest mascot palette. Lightness sits mid-range so
// gradients alpha-blend to vivid pastels over white instead of washed-out grey.
const HUE_PALETTE = [
  { h: 160, s: 80, l: 60 },
  { h: 130, s: 70, l: 62 },
  // Yellow's perceived weight is high; cap saturation below the other entries
  // so it doesn't dominate the header when it lands there.
  { h: 50, s: 75, l: 65 },
  { h: 20, s: 85, l: 65 },
  { h: 220, s: 85, l: 65 },
  { h: 270, s: 75, l: 68 },
];

// Quadrant-anchored blob centers keep gradient mass off the central text
// column (logo, wordmark, v-number) and force multi-blob renders to spread.
type Quadrant = 'TL' | 'TR' | 'BL' | 'BR';
const QUAD_CENTERS: Record<Quadrant, { x: number; y: number }> = {
  TL: { x: 18, y: 22 },
  TR: { x: 82, y: 22 },
  BL: { x: 18, y: 78 },
  BR: { x: 82, y: 78 },
};

function pickQuadrants(n: number): Quadrant[] {
  // For 2 blobs always pick a diagonal pair. Adjacent pairs (TL+TR, TR+BR,
  // BL+BR, TL+BL) cause two blobs to stack on the same side of the canvas,
  // which looks especially bad in `tonal` scheme where both blobs share a
  // hue family.
  if (n === 2) {
    return Math.random() < 0.5 ? ['TL', 'BR'] : ['TR', 'BL'];
  }
  const all: Quadrant[] = ['TL', 'TR', 'BL', 'BR'];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = all[i]!;
    all[i] = all[j]!;
    all[j] = tmp;
  }
  return all.slice(0, n);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Build a soft, diffuse background by stacking 1–3 ellipse-shaped radial
 * gradients over a white base, modeled on OpenAI's hero gradients.
 *
 * The end stop must keep the same hue and only drop alpha. Using the
 * `transparent` keyword would interpolate RGB toward black (CSS spec:
 * `transparent == rgba(0,0,0,0)`) and produce a grey halo around the
 * bright center.
 */
export function randomBackground(): string {
  const base = pick(HUE_PALETTE);

  const schemeRoll = Math.random();
  const scheme: 'tonal' | 'duo' | 'tri' =
    schemeRoll < 0.45 ? 'tonal' : schemeRoll < 0.85 ? 'duo' : 'tri';

  // Off-axis hues sit 90°–150° from the base. A smaller offset (e.g. cyan +
  // 60° = lavender) still reads as "same cool/warm family" and the two blobs
  // can feel like the same color when placed close together.
  const huePool: number[] = [base.h];
  if (scheme === 'duo' || scheme === 'tri') {
    huePool.push((base.h + 90 + Math.round(Math.random() * 60) + 360) % 360);
  }
  if (scheme === 'tri') {
    huePool.push((base.h - 90 - Math.round(Math.random() * 60) + 360) % 360);
  }

  // Weighted toward 1–2 blobs; 3+ overlapping blobs muddies the gradient.
  const blobRoll = Math.random();
  const blobCount = blobRoll < 0.35 ? 1 : blobRoll < 0.85 ? 2 : 3;
  const quads = pickQuadrants(blobCount);

  // Single-blob renders need a visibility floor — otherwise a small / dim /
  // edge-anchored blob can disappear entirely against the white base.
  const { minAlpha, maxAlpha, minSize } =
    blobCount === 1
      ? { minAlpha: 0.4, maxAlpha: 0.55, minSize: 50 }
      : { minAlpha: 0.3, maxAlpha: 0.5, minSize: 30 };

  const blobs = quads.map((quad) => {
    const seedHue = pick(huePool);
    const hueShift = Math.round((Math.random() - 0.5) * 30); // ±15°
    const h = (seedHue + hueShift + 360) % 360;
    const s = clamp(base.s + Math.round((Math.random() - 0.5) * 20), 50, 95);
    const l = clamp(base.l + Math.round((Math.random() - 0.5) * 12), 55, 78);

    const center = QUAD_CENTERS[quad];
    let x = Math.round(center.x + (Math.random() - 0.5) * 30); // anchor ±15%
    let y = Math.round(center.y + (Math.random() - 0.5) * 25); // anchor ±12.5%

    const w = Math.round(minSize + Math.random() * (85 - minSize));
    // Cap blob aspect ratio at ~1.4:1 so blobs read as soft ovals rather than
    // long bars. Independent w/h sampling can otherwise produce ~2.8:1.
    const MAX_RATIO = 1.4;
    const hLo = Math.max(minSize, w / MAX_RATIO);
    const hHi = Math.min(85, w * MAX_RATIO);
    const h2 = Math.round(hLo + Math.random() * (hHi - hLo));

    const alpha = (minAlpha + Math.random() * (maxAlpha - minAlpha)).toFixed(2);
    // Tighter end-stop keeps the alpha falloff crisp. Long tails (>=80%)
    // produce a "dingy beige/grey" halo for warm hues because pale tinted
    // pixels read as muddy when they cover a wide area over white.
    const endStop = Math.round(55 + Math.random() * 20); // 55% – 75%

    // Even within the 1.4:1 cap, an elongated blob whose long edges both sit
    // inside the canvas reads as a "bar" floating mid-frame. Hide one long
    // edge by pulling the blob's short-axis center toward the nearer canvas
    // edge — the result is a soft wash spilling in from that edge.
    const ASYM = 1.15;
    if (w / h2 > ASYM) {
      y = edgeHugCenter((h2 * endStop) / 100, center.y);
    } else if (h2 / w > ASYM) {
      x = edgeHugCenter((w * endStop) / 100, center.x);
    }

    const start = `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
    const end = `hsla(${h}, ${s}%, ${l}%, 0)`;
    return `radial-gradient(ellipse ${w}% ${h2}% at ${x}% ${y}%, ${start}, ${end} ${endStop}%)`;
  });
  return `${blobs.join(', ')}, #ffffff`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Place a blob's short-axis center near the nearer canvas edge (top vs bottom,
 * or left vs right, depending on `anchor`) so one long edge of an elongated
 * blob clips off-canvas instead of leaving both long edges visible mid-frame.
 *
 * `visibleSemi` is the visible semi-axis along the short axis
 * (`shortDim * endStop / 100`). The -8 keeps the gradient core slightly inside
 * the canvas so the wash still reads after the edge clip.
 */
function edgeHugCenter(visibleSemi: number, anchor: number): number {
  const maxOffset = Math.max(0, visibleSemi - 8);
  return anchor < 50
    ? Math.round(Math.random() * maxOffset)
    : Math.round(100 - Math.random() * maxOffset);
}

async function fetchLogoAsPng(): Promise<Buffer> {
  const response = await fetch(LOGO_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch logo from ${LOGO_URL}: ${response.status} ${response.statusText}`,
    );
  }
  const svgText = await response.text();
  // satori does not rasterize <img src="*.svg">, so rasterize the logo to PNG
  // first. 512px source stays crisp when the og PNG is rendered at 2x.
  const resvg = new Resvg(svgText, { fitTo: { mode: 'width', value: 512 } });
  return resvg.render().asPng();
}

export type RenderOptions = Omit<
  TemplateOptions,
  'logoDataUrl' | 'background' | 'layout'
> & {
  layout: Layout;
  /**
   * Shared gradient to reuse across a banner/og pair so both images of a
   * release match. Omit to roll a fresh one.
   */
  background?: string;
};

async function render(opts: RenderOptions): Promise<Buffer> {
  const [regular, bold, logoPng] = await Promise.all([
    readFile(path.join(fontsDir, 'SpaceGrotesk-Regular.ttf')),
    readFile(path.join(fontsDir, 'SpaceGrotesk-Bold.ttf')),
    fetchLogoAsPng(),
  ]);

  const logoDataUrl = `data:image/png;base64,${logoPng.toString('base64')}`;
  const tree = buildTemplate({
    ...opts,
    logoDataUrl,
    background: opts.background ?? randomBackground(),
  });

  const svg = await satori(tree, {
    width: opts.layout.width,
    height: opts.layout.height,
    fonts: [
      { name: 'Space Grotesk', data: regular, weight: 400, style: 'normal' },
      { name: 'Space Grotesk', data: bold, weight: 700, style: 'normal' },
    ],
  });

  // Render at 2x for crisp output on high-DPI displays. The og card (2400x1260)
  // stays well within social preview limits; the banner renders to 4096x1152.
  const resvg = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 } });
  return resvg.render().asPng();
}

/** 1200x630 → 2400x1260 social card, rendered with the tagline. */
export function renderOgImage(
  opts: Omit<RenderOptions, 'layout'>,
): Promise<Buffer> {
  return render({ ...opts, layout: LAYOUTS.og });
}

/** 2048x576 → 4096x1152 in-page blog banner, no tagline. */
export function renderBanner(
  opts: Omit<RenderOptions, 'layout' | 'description'>,
): Promise<Buffer> {
  return render({ ...opts, layout: LAYOUTS.banner });
}

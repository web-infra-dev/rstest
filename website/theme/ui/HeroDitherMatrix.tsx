import { useEffect, useRef } from 'react';

// 8x8 Bayer ordered dithering threshold matrix normalized to (0, 1).
const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64));

type BrowserKind = 'chromium' | 'firefox' | 'webkit';
type GlyphKind = 'pass' | 'failed' | 'arc' | BrowserKind;
type RGBA = readonly [number, number, number, number];
type Palette = readonly [RGBA, RGBA, RGBA, RGBA, RGBA];

// Tone indices into DARK_PALETTE / LIGHT_PALETTE.
const TONE_ETCHED = 0;
const TONE_MONO = 1;
const TONE_PASS = 2;
const TONE_RUN = 3;
const TONE_FAIL = 4;
type Tone =
  | typeof TONE_ETCHED
  | typeof TONE_MONO
  | typeof TONE_PASS
  | typeof TONE_RUN
  | typeof TONE_FAIL;

// Low-saturation architectural print palettes: preserves green/amber/red
// test semantics while staying quiet behind the Hero typography.
const DARK_PALETTE: Palette = [
  [136, 144, 140, 84],
  [136, 144, 140, 148],
  [82, 158, 134, 164],
  [180, 152, 98, 156],
  [178, 108, 106, 156],
];

const LIGHT_PALETTE: Palette = [
  [104, 114, 110, 66],
  [104, 114, 110, 132],
  [78, 152, 128, 146],
  [176, 138, 76, 142],
  [182, 104, 102, 142],
];

const BROWSER_KINDS: readonly BrowserKind[] = ['chromium', 'firefox', 'webkit'];
const GRID_ROWS = 8;
const PIXEL_SIZE = 2;
const FRAME_INTERVAL_MS = 33;

interface Slot {
  c: number;
  r: number;
  cx: number;
  cy: number;
  wavePos: number;
  inCenterClear: boolean;
  kind: GlyphKind;
  tone: Tone;
  phase: number;
  hoverBoost: number;
}

interface GridMetrics {
  width: number;
  height: number;
  cols: number;
  cellW: number;
  cellH: number;
}

// Match the parent CSS grid tracks (8/12/16 cols x 8 rows) so every icon
// centers cleanly inside its own 1px CSS cell.
function getGridLayout(viewportWidth: number): {
  cols: number;
  clearMargin: number;
} {
  if (viewportWidth >= 1024) return { cols: 16, clearMargin: 3 };
  if (viewportWidth >= 640) return { cols: 12, clearMargin: 1 };
  return { cols: 8, clearMargin: 0 };
}

function createSlots(
  cols: number,
  cellW: number,
  cellH: number,
  clearMargin: number,
): Slot[] {
  const slots: Slot[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const inCenterClear =
        c >= clearMargin &&
        c < cols - clearMargin &&
        r > 0 &&
        r < GRID_ROWS - 1;
      const hash = (((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0;
      const browserKind =
        hash % 3 === 0
          ? BROWSER_KINDS[(hash >>> 3) % BROWSER_KINDS.length]
          : undefined;

      let kind: GlyphKind;
      let tone: Tone;
      if (browserKind) {
        kind = browserKind;
        tone = TONE_MONO;
      } else if ((hash >>> 6) % 10 === 0) {
        // Keep failed cells sparse (~1 in 10 non-browser slots) so the matrix reads balanced.
        kind = 'failed';
        tone = TONE_FAIL;
      } else {
        kind = 'pass';
        tone = TONE_PASS;
      }

      slots.push({
        c,
        r,
        cx: (c + 0.5) * cellW,
        cy: (r + 0.5) * cellH,
        wavePos: (c + 0.5) / cols + (r / GRID_ROWS) * 0.08,
        inCenterClear,
        kind,
        tone,
        phase: (r * cols + c) * 0.65,
        hoverBoost: 0,
      });
    }
  }
  return slots;
}

function resolveSlotVisual(
  slot: Slot,
  scanHead: number,
  baseFloor: number,
): { kind: GlyphKind; intensity: number; tone: Tone } {
  const delta = scanHead - slot.wavePos;

  let kind: GlyphKind = slot.kind;
  let intensity = baseFloor;
  let tone: Tone = TONE_ETCHED;

  if (delta > -0.05 && delta < 0.08) {
    kind = 'arc';
    intensity = 0.84;
    tone = TONE_RUN;
  } else if (delta >= 0.08 && delta < 0.45) {
    const wake = 1 - (delta - 0.08) / 0.37;
    intensity = baseFloor + wake * 0.76;
    tone = slot.tone;
  }

  if (slot.hoverBoost > 0.05) {
    intensity = Math.max(intensity, Math.min(0.92, slot.hoverBoost));
    if (slot.hoverBoost > 0.66) {
      kind = 'arc';
      tone = TONE_RUN;
    } else {
      kind = slot.kind;
      tone = slot.tone;
    }
  }

  return { kind, intensity, tone };
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: GlyphKind,
  cx: number,
  cy: number,
  size: number,
  intensity: number,
  elapsed: number,
  phase: number,
) {
  if (intensity <= 0.02) return;
  ctx.save();
  ctx.translate(cx, cy);
  const r = size * 0.43;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const grad = ctx.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${(intensity * 0.7).toFixed(3)})`);
  grad.addColorStop(
    1,
    `rgba(255, 255, 255, ${Math.min(1, intensity * 1.05).toFixed(3)})`,
  );
  ctx.strokeStyle = grad;
  ctx.fillStyle = grad;

  switch (kind) {
    case 'pass':
      ctx.lineWidth = Math.max(2.1, size * 0.15);
      ctx.beginPath();
      ctx.moveTo(-r * 0.54, r * 0.04);
      ctx.lineTo(-r * 0.13, r * 0.48);
      ctx.lineTo(r * 0.6, -r * 0.44);
      ctx.stroke();
      break;

    case 'failed':
      ctx.lineWidth = Math.max(2.0, size * 0.14);
      ctx.beginPath();
      ctx.moveTo(-r * 0.44, -r * 0.44);
      ctx.lineTo(r * 0.44, r * 0.44);
      ctx.moveTo(r * 0.44, -r * 0.44);
      ctx.lineTo(-r * 0.44, r * 0.44);
      ctx.stroke();
      break;

    case 'arc': {
      const start = elapsed * 4.2 + phase;
      ctx.lineWidth = Math.max(1.9, size * 0.13);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.68, start, start + Math.PI * 1.32);
      ctx.stroke();
      break;
    }

    case 'chromium':
      ctx.lineWidth = Math.max(1.7, size * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.29, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * r * 0.29, Math.sin(angle) * r * 0.29);
        ctx.lineTo(
          Math.cos(angle + 0.62) * r * 0.78,
          Math.sin(angle + 0.62) * r * 0.78,
        );
        ctx.stroke();
      }
      break;

    case 'firefox':
      ctx.lineWidth = Math.max(2.2, size * 0.15);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, -0.45, Math.PI * 1.48);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${(intensity * 0.58).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, r * 0.04, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 'webkit':
      ctx.lineWidth = Math.max(1.6, size * 0.095);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(r * 0.52, -r * 0.52);
      ctx.lineTo(r * 0.14, r * 0.14);
      ctx.lineTo(-r * 0.52, r * 0.52);
      ctx.lineTo(-r * 0.14, -r * 0.14);
      ctx.closePath();
      ctx.fill();
      break;
  }

  ctx.restore();
}

function applyBayerDither(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  grid: GridMetrics,
  toneMap: Uint8Array,
  baseFloor: number,
  palette: Palette,
) {
  const { width, height, cols, cellW, cellH } = grid;
  dst.fill(0);

  for (let y = 0; y < height; y++) {
    const bayerRow = BAYER_8[y & 7]!;
    const rIdx = Math.min(GRID_ROWS - 1, Math.floor(y / cellH));

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = (src[idx + 3] ?? 0) / 255;
      if (alpha <= 0.03 || alpha <= bayerRow[x & 7]!) continue;

      const cIdx = Math.min(cols - 1, Math.floor(x / cellW));
      const rawTone = toneMap[rIdx * cols + cIdx] ?? TONE_ETCHED;
      const tone =
        rawTone === TONE_ETCHED || alpha < baseFloor + 0.06
          ? TONE_ETCHED
          : rawTone;
      const rgba = palette[tone] ?? palette[TONE_ETCHED];

      dst[idx] = rgba[0];
      dst[idx + 1] = rgba[1];
      dst[idx + 2] = rgba[2];
      dst[idx + 3] = rgba[3];
    }
  }
}

/**
 * Low-saturation Bayer-dithered test & browser icon matrix driven by a calm
 * left-to-right execution scan wave. Columns stay a multiple of 4 so grid lines
 * align with the page's 25% / 50% / 75% architectural rails.
 */
export function HeroDitherMatrix() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const offscreen = document.createElement('canvas');
    const offscreenCtx = offscreen.getContext('2d', {
      willReadFrequently: true,
    });
    if (!offscreenCtx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    let grid: GridMetrics = {
      width: 0,
      height: 0,
      cols: 16,
      cellW: 0,
      cellH: 0,
    };
    let slots: Slot[] = [];
    let toneMap = new Uint8Array(0);
    let outImg: ImageData | null = null;
    let inView = true;
    let rafId = 0;
    let elapsed = 2.1;
    let lastNow = performance.now();
    let lastDraw = 0;

    const rebuild = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const width = Math.max(120, Math.floor(rect.width / PIXEL_SIZE));
      const height = Math.max(100, Math.floor(rect.height / PIXEL_SIZE));
      canvas.width = width;
      canvas.height = height;
      offscreen.width = width;
      offscreen.height = height;
      outImg = ctx.createImageData(width, height);

      const { cols, clearMargin } = getGridLayout(window.innerWidth);
      const cellW = width / cols;
      const cellH = height / GRID_ROWS;
      grid = { width, height, cols, cellW, cellH };
      toneMap = new Uint8Array(cols * GRID_ROWS);
      slots = createSlots(cols, cellW, cellH, clearMargin);
    };

    const drawFrame = (dt: number) => {
      if (!outImg || grid.width === 0 || grid.height === 0) return;

      offscreenCtx.clearRect(0, 0, grid.width, grid.height);
      toneMap.fill(TONE_ETCHED);

      const isDark = document.documentElement.classList.contains('dark');
      const baseFloor = isDark ? 0.15 : 0.13;
      const iconSize = Math.min(grid.cellW, grid.cellH) * 0.62;
      const scanHead = ((elapsed * 0.17) % 1.45) - 0.18;

      for (const slot of slots) {
        if (slot.inCenterClear) continue;
        if (dt > 0) {
          slot.hoverBoost = Math.max(0, slot.hoverBoost - dt * 1.8);
        }

        const { kind, intensity, tone } = resolveSlotVisual(
          slot,
          scanHead,
          baseFloor,
        );
        toneMap[slot.r * grid.cols + slot.c] = tone;
        drawGlyph(
          offscreenCtx,
          kind,
          slot.cx,
          slot.cy,
          iconSize,
          intensity,
          elapsed,
          slot.phase,
        );
      }

      const src = offscreenCtx.getImageData(0, 0, grid.width, grid.height).data;
      applyBayerDither(
        src,
        outImg.data,
        grid,
        toneMap,
        baseFloor,
        isDark ? DARK_PALETTE : LIGHT_PALETTE,
      );
      ctx.putImageData(outImg, 0, 0);
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (!inView || document.hidden) {
        lastNow = now;
        return;
      }
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      lastDraw = now;
      elapsed += dt;
      drawFrame(dt);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || grid.cellW === 0 || grid.cellH === 0) return;
      const rect = host.getBoundingClientRect();
      const lx = (event.clientX - rect.left) / PIXEL_SIZE;
      const ly = (event.clientY - rect.top) / PIXEL_SIZE;
      if (lx < 0 || ly < 0 || lx >= grid.width || ly >= grid.height) return;
      const c = Math.floor(lx / grid.cellW);
      const r = Math.floor(ly / grid.cellH);
      const slot = slots[r * grid.cols + c];
      if (!slot || slot.inCenterClear) return;
      slot.hoverBoost = 0.94;
    };

    const resizeObserver = new ResizeObserver(() => {
      rebuild();
      drawFrame(0);
    });
    resizeObserver.observe(host);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(host);

    const themeObserver = new MutationObserver(() => {
      if (reducedMotion) drawFrame(0);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    host.addEventListener('pointermove', onPointerMove, { passive: true });

    rebuild();
    drawFrame(0);
    if (!reducedMotion) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      host.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full [image-rendering:pixelated]"
    />
  );
}

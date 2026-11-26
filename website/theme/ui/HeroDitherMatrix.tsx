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

type GlyphKind = 'pass' | 'failed' | 'arc' | 'chromium' | 'firefox' | 'webkit';

// 0 = quiet etched base, 1 = monochrome browser, 2 = muted mint pass,
// 3 = muted amber running arc, 4 = muted dusty-red failed cross.
const TONE_ETCHED = 0;
const TONE_MONO = 1;
const TONE_PASS = 2;
const TONE_RUN = 3;
const TONE_FAIL = 4;

interface Slot {
  c: number;
  r: number;
  cx: number;
  cy: number;
  wavePos: number;
  inCenterClear: boolean;
  browserKind: 'chromium' | 'firefox' | 'webkit' | null;
  isFailed: boolean;
  phase: number;
  hoverBoost: number;
}

const BROWSER_KINDS: ('chromium' | 'firefox' | 'webkit')[] = [
  'chromium',
  'firefox',
  'webkit',
];

const PIXEL_SIZE = 2;
const FRAME_INTERVAL_MS = 33;

function drawGlyph(
  g: CanvasRenderingContext2D,
  kind: GlyphKind,
  cx: number,
  cy: number,
  size: number,
  intensity: number,
  t: number,
  phase: number,
) {
  if (intensity <= 0.02) return;
  g.save();
  g.translate(cx, cy);
  const r = size * 0.43;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const grad = g.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, `rgba(255, 255, 255, ${(intensity * 0.7).toFixed(3)})`);
  grad.addColorStop(
    1,
    `rgba(255, 255, 255, ${Math.min(1, intensity * 1.05).toFixed(3)})`,
  );
  g.strokeStyle = grad;
  g.fillStyle = grad;

  if (kind === 'pass') {
    g.lineWidth = Math.max(2.1, size * 0.15);
    g.beginPath();
    g.moveTo(-r * 0.54, r * 0.04);
    g.lineTo(-r * 0.13, r * 0.48);
    g.lineTo(r * 0.6, -r * 0.44);
    g.stroke();
  } else if (kind === 'failed') {
    g.lineWidth = Math.max(2.0, size * 0.14);
    g.beginPath();
    g.moveTo(-r * 0.44, -r * 0.44);
    g.lineTo(r * 0.44, r * 0.44);
    g.moveTo(r * 0.44, -r * 0.44);
    g.lineTo(-r * 0.44, r * 0.44);
    g.stroke();
  } else if (kind === 'arc') {
    const start = t * 4.2 + phase;
    g.lineWidth = Math.max(1.9, size * 0.13);
    g.beginPath();
    g.arc(0, 0, r * 0.68, start, start + Math.PI * 1.32);
    g.stroke();
  } else if (kind === 'chromium') {
    g.lineWidth = Math.max(1.7, size * 0.1);
    g.beginPath();
    g.arc(0, 0, r * 0.78, 0, Math.PI * 2);
    g.stroke();

    g.beginPath();
    g.arc(0, 0, r * 0.29, 0, Math.PI * 2);
    g.fill();

    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.29, Math.sin(a) * r * 0.29);
      g.lineTo(Math.cos(a + 0.62) * r * 0.78, Math.sin(a + 0.62) * r * 0.78);
      g.stroke();
    }
  } else if (kind === 'firefox') {
    g.lineWidth = Math.max(2.2, size * 0.15);
    g.beginPath();
    g.arc(0, 0, r * 0.72, -0.45, Math.PI * 1.48);
    g.stroke();

    g.fillStyle = `rgba(255, 255, 255, ${(intensity * 0.58).toFixed(3)})`;
    g.beginPath();
    g.arc(0, r * 0.04, r * 0.32, 0, Math.PI * 2);
    g.fill();
  } else {
    g.lineWidth = Math.max(1.6, size * 0.095);
    g.beginPath();
    g.arc(0, 0, r * 0.78, 0, Math.PI * 2);
    g.stroke();

    g.beginPath();
    g.moveTo(r * 0.52, -r * 0.52);
    g.lineTo(r * 0.14, r * 0.14);
    g.lineTo(-r * 0.52, r * 0.52);
    g.lineTo(-r * 0.14, -r * 0.14);
    g.closePath();
    g.fill();
  }

  g.restore();
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

    const off = document.createElement('canvas');
    const offscreenCtx = off.getContext('2d', { willReadFrequently: true });
    if (!offscreenCtx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    let slots: Slot[] = [];
    let toneMap = new Uint8Array(0);
    let gw = 0;
    let gh = 0;
    let cols = 16;
    let rows = 8;
    let cellW = 0;
    let cellH = 0;
    let outImg: ImageData | null = null;
    let inView = true;
    let rafId = 0;
    let elapsed = 2.1;
    let lastNow = performance.now();
    let lastDraw = 0;

    const rebuild = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      gw = Math.max(120, Math.floor(rect.width / PIXEL_SIZE));
      gh = Math.max(100, Math.floor(rect.height / PIXEL_SIZE));
      canvas.width = gw;
      canvas.height = gh;
      off.width = gw;
      off.height = gh;
      outImg = ctx.createImageData(gw, gh);

      cols = rect.width >= 960 ? 16 : rect.width >= 640 ? 12 : 8;
      cellW = gw / cols;
      rows = Math.max(5, Math.round(gh / cellW));
      cellH = gh / rows;
      toneMap = new Uint8Array(cols * rows);

      const isNarrow = rect.width < 640;
      slots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = (c + 0.5) / cols;
          const inCenterClear = isNarrow
            ? r > 0 && r < rows - 1
            : nx > 0.2 && nx < 0.8 && r > 0 && r < rows - 1;

          const hash = (((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0;
          const browserKind =
            hash % 3 === 0
              ? (BROWSER_KINDS[(hash >>> 3) % BROWSER_KINDS.length] ?? null)
              : null;
          // Keep failed cells sparse (~1 in 10 non-browser slots) so the matrix reads balanced.
          const isFailed = !browserKind && (hash >>> 6) % 10 === 0;

          slots.push({
            c,
            r,
            cx: (c + 0.5) * cellW,
            cy: (r + 0.5) * cellH,
            wavePos: nx + (r / rows) * 0.08,
            inCenterClear,
            browserKind,
            isFailed,
            phase: (r * cols + c) * 0.65,
            hoverBoost: 0,
          });
        }
      }
    };

    const drawFrame = (dt: number) => {
      if (!outImg || gw === 0 || gh === 0) return;

      offscreenCtx.clearRect(0, 0, gw, gh);
      toneMap.fill(TONE_ETCHED);

      const isDark = document.documentElement.classList.contains('dark');
      const baseFloor = isDark ? 0.15 : 0.13;
      const iconSize = Math.min(cellW, cellH) * 0.62;
      const scanHead = ((elapsed * 0.17) % 1.45) - 0.18;

      for (const s of slots) {
        if (s.inCenterClear) continue;
        if (dt > 0) {
          s.hoverBoost = Math.max(0, s.hoverBoost - dt * 1.8);
        }

        const delta = scanHead - s.wavePos;
        const resolvedKind: GlyphKind =
          s.browserKind ?? (s.isFailed ? 'failed' : 'pass');
        const resolvedTone = s.browserKind
          ? TONE_MONO
          : s.isFailed
            ? TONE_FAIL
            : TONE_PASS;

        let kind: GlyphKind = resolvedKind;
        let intensity = baseFloor;
        let tone = TONE_ETCHED;

        if (delta > -0.05 && delta < 0.08) {
          kind = 'arc';
          intensity = 0.84;
          tone = TONE_RUN;
        } else if (delta >= 0.08 && delta < 0.45) {
          const wake = 1 - (delta - 0.08) / 0.37;
          intensity = baseFloor + wake * 0.76;
          tone = resolvedTone;
        }

        if (s.hoverBoost > 0.05) {
          intensity = Math.max(intensity, Math.min(0.92, s.hoverBoost));
          if (s.hoverBoost > 0.66) {
            kind = 'arc';
            tone = TONE_RUN;
          } else {
            kind = resolvedKind;
            tone = resolvedTone;
          }
        }

        toneMap[s.r * cols + s.c] = tone;
        drawGlyph(
          offscreenCtx,
          kind,
          s.cx,
          s.cy,
          iconSize,
          intensity,
          elapsed,
          s.phase,
        );
      }

      const src = offscreenCtx.getImageData(0, 0, gw, gh).data;
      const dst = outImg.data;
      dst.fill(0);

      // Low-saturation architectural print palette: preserves green/amber/red
      // test semantics while staying quiet behind the Hero typography.
      const colPass: [number, number, number] = isDark
        ? [82, 158, 134]
        : [78, 152, 128];
      const colRun: [number, number, number] = isDark
        ? [180, 152, 98]
        : [176, 138, 76];
      const colFail: [number, number, number] = isDark
        ? [178, 108, 106]
        : [182, 104, 102];
      const colMono: [number, number, number] = isDark
        ? [136, 144, 140]
        : [104, 114, 110];
      const colGrid: [number, number, number] = isDark
        ? [36, 40, 38]
        : [226, 230, 228];
      const gridAlpha = isDark ? 82 : 100;

      for (let y = 0; y < gh; y++) {
        const bayerRow = BAYER_8[y & 7]!;
        const isHLine = y > 0 && Math.abs(y % cellH) < 1;
        const rIdx = Math.min(rows - 1, Math.floor(y / cellH));

        for (let x = 0; x < gw; x++) {
          const idx = (y * gw + x) * 4;
          const isVLine = x > 0 && Math.abs(x % cellW) < 1;

          if (isHLine || isVLine) {
            dst[idx] = colGrid[0];
            dst[idx + 1] = colGrid[1];
            dst[idx + 2] = colGrid[2];
            dst[idx + 3] = gridAlpha;
          }

          const a = (src[idx + 3] ?? 0) / 255;
          if (a <= 0.03) continue;

          if (a > bayerRow[x & 7]!) {
            const cIdx = Math.min(cols - 1, Math.floor(x / cellW));
            const tone = toneMap[rIdx * cols + cIdx] ?? TONE_ETCHED;
            const isResting = tone === TONE_ETCHED || a < baseFloor + 0.06;

            let col = colMono;
            let alpha = isDark ? 148 : 132;

            if (isResting) {
              col = colMono;
              alpha = isDark ? 84 : 66;
            } else if (tone === TONE_PASS) {
              col = colPass;
              alpha = isDark ? 164 : 146;
            } else if (tone === TONE_RUN) {
              col = colRun;
              alpha = isDark ? 156 : 142;
            } else if (tone === TONE_FAIL) {
              col = colFail;
              alpha = isDark ? 156 : 142;
            }

            dst[idx] = col[0];
            dst[idx + 1] = col[1];
            dst[idx + 2] = col[2];
            dst[idx + 3] = alpha;
          }
        }
      }

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

    const onPointerMove = (e: PointerEvent) => {
      if (reducedMotion || cellW === 0 || cellH === 0) return;
      const rect = host.getBoundingClientRect();
      const lx = (e.clientX - rect.left) / PIXEL_SIZE;
      const ly = (e.clientY - rect.top) / PIXEL_SIZE;
      if (lx < 0 || ly < 0 || lx >= gw || ly >= gh) return;
      const c = Math.floor(lx / cellW);
      const r = Math.floor(ly / cellH);
      const slot = slots[r * cols + c];
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

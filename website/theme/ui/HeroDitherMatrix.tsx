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

type GlyphKind =
  'pass' | 'running' | 'failed' | 'chromium' | 'firefox' | 'webkit';

type SlotState = 'idle' | 'in' | 'hold' | 'out';

interface Slot {
  cx: number;
  cy: number;
  inCenterClear: boolean;
  baseKind: GlyphKind;
  kind: GlyphKind;
  state: SlotState;
  timer: number;
  duration: number;
  level: number;
  phase: number;
  hoverBoost: number;
}

const ICON_POOL: GlyphKind[] = [
  'pass',
  'pass',
  'pass',
  'chromium',
  'firefox',
  'webkit',
  'running',
  'failed',
];

const PIXEL_SIZE = 2;
const FRAME_INTERVAL_MS = 33;

function drawIcon(
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
  const r = size * 0.44;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const gradOf = (rgb: string, base: number) => {
    const gr = g.createLinearGradient(-r, -r, r, r);
    gr.addColorStop(0, `rgba(${rgb}, ${(base * 0.72).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${rgb}, ${Math.min(1, base * 1.05).toFixed(3)})`);
    return gr;
  };

  if (kind === 'pass') {
    g.strokeStyle = gradOf('25, 240, 140', intensity);
    g.lineWidth = Math.max(2.2, size * 0.16);
    g.beginPath();
    g.moveTo(-r * 0.56, r * 0.04);
    g.lineTo(-r * 0.14, r * 0.48);
    g.lineTo(r * 0.62, -r * 0.44);
    g.stroke();
  } else if (kind === 'running') {
    const rot = t * 3.2 + phase;
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = rot + (i * Math.PI * 2) / spokes;
      const alpha = intensity * (0.18 + (i / spokes) * 0.82);
      g.strokeStyle = `rgba(248, 182, 48, ${alpha.toFixed(3)})`;
      g.lineWidth = Math.max(1.8, size * 0.11);
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34);
      g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      g.stroke();
    }
  } else if (kind === 'failed') {
    g.strokeStyle = gradOf('244, 82, 82', intensity);
    g.lineWidth = Math.max(2.2, size * 0.15);
    g.beginPath();
    g.moveTo(-r * 0.46, -r * 0.46);
    g.lineTo(r * 0.46, r * 0.46);
    g.moveTo(r * 0.46, -r * 0.46);
    g.lineTo(-r * 0.46, r * 0.46);
    g.stroke();
  } else if (kind === 'chromium') {
    const rgb = '90, 130, 255';
    g.strokeStyle = gradOf(rgb, intensity * 0.92);
    g.lineWidth = Math.max(1.8, size * 0.1);
    g.beginPath();
    g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = gradOf(rgb, intensity);
    g.beginPath();
    g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    g.fill();

    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      g.lineTo(Math.cos(a + 0.62) * r * 0.8, Math.sin(a + 0.62) * r * 0.8);
      g.stroke();
    }
  } else if (kind === 'firefox') {
    const rgb = '90, 130, 255';
    g.strokeStyle = gradOf(rgb, intensity * 0.95);
    g.lineWidth = Math.max(2.3, size * 0.15);
    g.beginPath();
    g.arc(0, 0, r * 0.72, -0.45, Math.PI * 1.48);
    g.stroke();

    g.fillStyle = gradOf(rgb, intensity * 0.6);
    g.beginPath();
    g.arc(0, r * 0.04, r * 0.33, 0, Math.PI * 2);
    g.fill();
  } else {
    const rgb = '90, 130, 255';
    g.strokeStyle = gradOf(rgb, intensity * 0.9);
    g.lineWidth = Math.max(1.7, size * 0.095);
    g.beginPath();
    g.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = gradOf(rgb, intensity);
    g.beginPath();
    g.moveTo(r * 0.54, -r * 0.54);
    g.lineTo(r * 0.14, r * 0.14);
    g.lineTo(-r * 0.54, r * 0.54);
    g.lineTo(-r * 0.14, -r * 0.14);
    g.closePath();
    g.fill();
  }

  g.restore();
}

function triggerSlot(slot: Slot, nextKind: GlyphKind) {
  slot.kind = nextKind;
  slot.state = 'in';
  slot.timer = 0;
  slot.duration = nextKind === 'running' ? 1.35 : 2.1 + Math.random() * 1.4;
}

/**
 * Fixed-slot Bayer dithered test & browser icon matrix behind the Hero.
 * Columns are always a multiple of 4 so vertical lines stay aligned with the
 * page's 25% / 50% / 75% architectural grid.
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
    let gw = 0;
    let gh = 0;
    let cols = 16;
    let cellW = 0;
    let cellH = 0;
    let outImg: ImageData | null = null;
    let inView = true;
    let rafId = 0;
    let elapsed = 0;
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
      const rows = Math.max(5, Math.round(gh / cellW));
      cellH = gh / rows;

      const isNarrow = rect.width < 640;
      slots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = (c + 0.5) / cols;
          const inCenterClear = isNarrow
            ? r > 0 && r < rows - 1
            : nx > 0.2 && nx < 0.8 && r > 0 && r < rows - 1;

          const hash = (((r + 1) * 73856093) ^ ((c + 1) * 19349663)) >>> 0;
          const baseKind = ICON_POOL[hash % ICON_POOL.length] ?? 'pass';
          const startLit = !inCenterClear && hash % 10 < 3;
          const initialKind =
            ICON_POOL[(hash >>> 4) % (ICON_POOL.length - 1)] ?? 'pass';

          slots.push({
            cx: (c + 0.5) * cellW,
            cy: (r + 0.5) * cellH,
            inCenterClear,
            baseKind,
            kind: startLit ? initialKind : baseKind,
            state: startLit ? 'hold' : 'idle',
            timer: startLit
              ? 0.6 + (hash % 7) * 0.45
              : 0.4 + (hash % 29) * 0.25,
            duration: 2.2 + (hash % 4) * 0.5,
            level: startLit ? 0.92 : 0,
            phase: (r * cols + c) * 0.9,
            hoverBoost: 0,
          });
        }
      }
    };

    const drawFrame = (dt: number) => {
      if (!outImg || gw === 0 || gh === 0) return;

      offscreenCtx.clearRect(0, 0, gw, gh);
      const isDark = document.documentElement.classList.contains('dark');
      const baseFloor = isDark ? 0.17 : 0.14;
      const iconSize = Math.min(cellW, cellH) * 0.64;

      for (const s of slots) {
        if (s.inCenterClear) continue;

        if (!reducedMotion && dt > 0) {
          if (s.state === 'idle') {
            s.level = Math.max(0, s.level - dt * 1.6);
            s.timer -= dt;
            if (s.timer <= 0) {
              const roll = Math.random();
              const next: GlyphKind =
                roll < 0.34
                  ? 'running'
                  : roll < 0.64
                    ? 'pass'
                    : roll < 0.76
                      ? 'chromium'
                      : roll < 0.87
                        ? 'firefox'
                        : roll < 0.95
                          ? 'webkit'
                          : 'failed';
              triggerSlot(s, next);
            }
          } else if (s.state === 'in') {
            s.level = Math.min(1, s.level + dt * 2.2);
            if (s.level >= 1) {
              s.state = 'hold';
              s.timer = s.duration;
            }
          } else if (s.state === 'hold') {
            s.timer -= dt;
            if (s.timer <= 0) {
              if (s.kind === 'running') {
                s.kind = Math.random() < 0.9 ? 'pass' : 'failed';
                s.timer = 2.0 + Math.random() * 1.2;
              } else if (s.kind === 'failed') {
                // Failed test retries into running -> pass like watch mode.
                s.kind = 'running';
                s.timer = 1.2;
              } else {
                s.state = 'out';
              }
            }
          } else {
            s.level = Math.max(0, s.level - dt * 1.4);
            if (s.level <= 0) {
              s.state = 'idle';
              s.timer = 1.8 + Math.random() * 5.2;
            }
          }
          s.hoverBoost = Math.max(0, s.hoverBoost - dt * 2.4);
        }

        const drawLevel = Math.min(
          1,
          Math.max(baseFloor, s.level, s.hoverBoost),
        );
        const drawKind =
          s.level > 0.04 || s.hoverBoost > 0.04 ? s.kind : s.baseKind;

        drawIcon(
          offscreenCtx,
          drawKind,
          s.cx,
          s.cy,
          iconSize,
          drawLevel,
          elapsed,
          s.phase,
        );
      }

      const src = offscreenCtx.getImageData(0, 0, gw, gh).data;
      const dst = outImg.data;
      dst.fill(0);

      const colPass: [number, number, number] = isDark
        ? [56, 198, 156]
        : [49, 162, 129];
      const colRun: [number, number, number] = isDark
        ? [230, 174, 74]
        : [204, 134, 30];
      const colFail: [number, number, number] = isDark
        ? [228, 98, 92]
        : [210, 72, 66];
      const colBrowser: [number, number, number] = isDark
        ? [154, 164, 160]
        : [94, 106, 101];
      const colGrid: [number, number, number] = isDark
        ? [36, 40, 38]
        : [226, 230, 228];
      const gridAlpha = isDark ? 88 : 108;

      for (let y = 0; y < gh; y++) {
        const bayerRow = BAYER_8[y & 7]!;
        const isHLine = y > 0 && Math.abs(y % cellH) < 1;

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
            const r = src[idx] ?? 0;
            const g = src[idx + 1] ?? 0;

            let col = colBrowser;
            let alpha = isDark ? 182 : 160;

            if (a < baseFloor + 0.06) {
              col = colBrowser;
              alpha = isDark ? 96 : 74;
            } else if (g > 170 && r < 120) {
              col = colPass;
              alpha = isDark ? 228 : 205;
            } else if (r > 180 && g > 130) {
              col = colRun;
              alpha = isDark ? 208 : 186;
            } else if (r > 180 && g < 130) {
              col = colFail;
              alpha = isDark ? 208 : 186;
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
      slot.hoverBoost = 0.98;
      if (slot.state === 'idle') {
        triggerSlot(slot, 'running');
      }
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

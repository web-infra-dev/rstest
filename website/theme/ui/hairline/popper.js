import { HL } from './kernel.js';
import tsIcon from './popper-icons/ts.svg';
import jsIcon from './popper-icons/js.svg';
import cssIcon from './popper-icons/css.svg';
import swcIcon from './popper-icons/swc.svg';
import reactIcon from './popper-icons/react.svg';
import vueIcon from './popper-icons/vue.svg';
import lessIcon from './popper-icons/less.svg';
import sassIcon from './popper-icons/sass.svg';
import playwrightIcon from './popper-icons/playwright.svg';
import chromeIcon from './popper-icons/chrome.svg';
import nodeIcon from './popper-icons/node.svg';
import istanbulIcon from './popper-icons/istanbul.svg';
import webkitIcon from './popper-icons/webkit.svg';
import firefoxIcon from './popper-icons/firefox.svg';
import rspackIcon from './popper-icons/rspack.svg';
import rsbuildIcon from './popper-icons/rsbuild.svg';
import rstestIcon from './popper-icons/rstest.svg';

/**
 * Popper: an open cardboard box with the Rstest mascot printed on its side keeps
 * popping the tools Rstest works with (TypeScript, React, Vue, Sass, Playwright,
 * the browsers, Node.js, the Rstack) in their own colors. It plays on its own;
 * hovering slows the clock and lights the logo nearest the pointer. The slider
 * value is the hovered rate.
 */
const {
  Cam,
  clamp,
  disposer,
  facing,
  fillet,
  fit,
  mk,
  open,
  pointer,
  poly,
  prism,
  proj,
  put,
  rad,
  register,
  ringAt,
  rings,
  run,
  seg,
  solid,
  spring,
  stepS,
  unproj,
} = HL;

// Box (world units): a cube with wall thickness WT and four flaps of length F.
const D = 45,
  H = 40,
  WT = 4,
  F = 19,
  PB = rad(58),
  PF = rad(6);
// Pieces: square tile of side T, icon of side I, gravity G, pop interval POP.
const T = 30,
  I = 22,
  G = 520,
  POP = 0.11,
  CAP = 11,
  EDGE = 18,
  TOP = 50;
// The whole clock runs at CLOCK of the physics above: same arcs, calmer pace.
const CLOCK = 0.68;
const KINDS = [
  'ts',
  'js',
  'css',
  'swc',
  'react',
  'vue',
  'less',
  'sass',
  'playwright',
  'chrome',
  'node',
  'istanbul',
  'rspack',
  'rsbuild',
  'webkit',
  'firefox',
];
// Official logos, unmodified, bundled with the site.
const IMG = {
  ts: tsIcon,
  js: jsIcon,
  css: cssIcon,
  swc: swcIcon,
  react: reactIcon,
  vue: vueIcon,
  less: lessIcon,
  sass: sassIcon,
  playwright: playwrightIcon,
  chrome: chromeIcon,
  node: nodeIcon,
  istanbul: istanbulIcon,
  webkit: webkitIcon,
  firefox: firefoxIcon,
  rspack: rspackIcon,
  rsbuild: rsbuildIcon,
  rstest: rstestIcon,
};
const TILE = fillet(
  [
    [-T / 2, -T / 2],
    [T / 2, -T / 2],
    [T / 2, T / 2],
    [-T / 2, T / 2],
  ],
  [5, 5, 5, 5],
);

function mount({ stage, svg, read }, value, autoplay = false) {
  const bag = disposer(),
    OP = 'opa' + 'city';
  let slow = clamp(value, 0.02, 1),
    over = false,
    playing = autoplay,
    ptr = [200, 160],
    pop = 0.05,
    seed = 1941;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Camera: the box sits low, the air above it is where the logos fly.
  const C = Cam(45, 0.5, 1.5);
  const tip = (ph) => [F * Math.cos(ph), H + F * Math.sin(ph)];
  const [ob, zb] = tip(PB),
    [of, zf] = tip(PF);
  fit(
    C,
    [
      [-ob, 0, zb],
      [0, -ob, zb],
      [D + of, D, zf],
      [D, D + of, zf],
      [D, D, 0],
      [0, 0, 0],
    ],
    200,
    246,
  );
  const P = proj(C),
    front = facing(C);

  const g = mk('g', {}, svg),
    backG = mk('g', {}, g),
    boxG = mk('g', {}, g),
    nearG = mk('g', {}, g),
    airG = mk('g', {}, g);

  // Cardboard, in lines only: the walls, the rim, the front corner, packing
  // tape and a "this way up" mark.
  const [outer] = rings(0, 0, D, D, 1.5, 1.2);
  put(solid(boxG), { sil: prism(P, front, outer, null, 0, H).sil, crease: '' });
  // The far inner corner, seen through the mouth, gives the box its depth.
  mk('path', { class: 'nf lo', d: seg(P(0, 0, H), P(0, 0, H - 22)) }, boxG);
  // Hidden edges, dashed: the two far bottom edges and the rest of the back corner.
  mk(
    'path',
    {
      class: 'nf lo dash',
      d:
        open([P(0, D, 0), P(0, 0, 0), P(D, 0, 0)]) +
        seg(P(0, 0, 0), P(0, 0, H - 22)),
    },
    boxG,
  );
  mk('path', { class: 'sil nf', d: poly(ringAt(P, outer, H)) }, boxG);
  mk('path', { class: 'nf', d: seg(P(D, D, 0), P(D, D, H)) }, boxG);
  // Packing tape down the middle of the left face, cut with a zigzag end.
  const tw = 4.5,
    tz = H * 0.3,
    zig = [];
  for (let k = 0; k <= 4; k++)
    zig.push([D / 2 + tw - (2 * tw * k) / 4, D, tz + (k % 2 ? 2.2 : 0)]);
  mk(
    'path',
    {
      class: 'lo',
      d: poly(
        [[D / 2 - tw, D, H], [D / 2 + tw, D, H], ...zig].map((p) => P(...p)),
      ),
    },
    boxG,
  );
  // "This way up": two arrows over a bar, near the left face's far edge.
  const up = (x) =>
    seg(P(x, D, H * 0.22), P(x, D, H * 0.6)) +
    open([P(x - 2.4, D, H * 0.5), P(x, D, H * 0.6), P(x + 2.4, D, H * 0.5)]);
  mk(
    'path',
    {
      class: 'nf lo',
      d: up(7.5) + up(13.5) + seg(P(4.5, D, H * 0.16), P(16.5, D, H * 0.16)),
    },
    boxG,
  );

  // Rstest mascot printed on the front-right face (x = D). Image +u runs along
  // -y (screen right), +v along -z (screen down): no reflection.
  const LZ = H * 0.44,
    LH = 0.58 * H,
    LW = (LH * 217) / 200,
    c0 = P(D, D / 2, LZ);
  const du = P(D, D / 2 - 1, LZ),
    dv = P(D, D / 2, LZ - 1);
  const m = [du[0] - c0[0], du[1] - c0[1], dv[0] - c0[0], dv[1] - c0[1]];
  mk(
    'image',
    {
      href: IMG.rstest,
      x: -LW / 2,
      y: -LH / 2,
      width: LW,
      height: LH,
      preserveAspectRatio: 'xMidYMid meet',
      transform: `matrix(${m.join(' ')} ${c0[0]} ${c0[1]})`,
    },
    boxG,
  );

  // Flaps hinge on the rim and splay outward and up: the back pair steeper, the
  // front pair lower. Each pop kicks them open a little wider.
  const kick = spring(0, { k: 160, c: 14 }),
    flaps = [];
  const flap = (parent, ph, q) =>
    flaps.push({ face: mk('path', { class: 'sil' }, parent), ph, q });
  flap(backG, PB, (a, o, z) => [-o, a, z]);
  flap(backG, PB, (a, o, z) => [a, -o, z]);
  flap(nearG, PF, (a, o, z) => [a, D + o, z]);
  flap(nearG, PF, (a, o, z) => [D + o, a, z]);
  const drawFlaps = () => {
    for (const { face, ph, q } of flaps) {
      const [d, z] = tip(ph - rad(kick.x)),
        t = 3;
      face.setAttribute(
        'd',
        poly(
          [q(0, 0, H), q(D, 0, H), q(D - t, d, z), q(t, d, z)].map((p) =>
            P(...p),
          ),
        ),
      );
    }
  };
  drawFlaps();

  // Pieces: a tile with the logo, always drawn in front of the whole box.
  const pieces = [];
  let deck = [];
  const nextKind = () => {
    if (!deck.length) {
      deck = KINDS.slice();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    return deck.pop();
  };
  const build = (kind) => {
    const grp = mk('g', { 'data-piece': '', 'data-kind': kind }, airG);
    mk(
      'path',
      { class: 'lo', d: poly(TILE.map(([x, y]) => [x + 1.8, y + 1.8])) },
      grp,
    );
    const face = mk('path', { class: 'sil', d: poly(TILE) }, grp);
    mk(
      'image',
      {
        href: IMG[kind],
        x: -I / 2,
        y: -I / 2,
        width: I,
        height: I,
        preserveAspectRatio: 'xMidYMid meet',
      },
      grp,
    );
    return { kind, g: grp, face };
  };
  const at = (p, t) => {
    const x = p.x0 + p.vx * t + 0.5 * p.ax * t * t,
      y = p.y0 + p.vy * t + 0.5 * p.ay * t * t,
      z = p.z0 + p.vz * t - 0.5 * G * t * t;
    const [sx, sy] = P(x, y, z);
    return { x, y, z, sx, sy, down: t > p.vz / G };
  };
  // On the way down a piece fades out before it sinks to the box's mouth line.
  const mouthY = P(D / 2, D / 2, H)[1];
  // The top band of the stage is cropped on the page, so the arcs stay below TOP.
  const offStage = (s) =>
    s.sx < EDGE || s.sx > 400 - EDGE || s.sy < TOP || s.sy > 320 - EDGE;
  // Smallest screen distance between a candidate path and every piece in flight.
  const gap = (c) => {
    let min = Infinity;
    for (let t = 0.04; t < 1.6; t += 0.04) {
      const a = at(c, t);
      if (offStage(a) || (a.down && a.sy > mouthY - 16)) break;
      for (const q of pieces) {
        const b = at(q, q.age + t);
        if (!(b.down && b.sy > mouthY - 16))
          min = Math.min(min, Math.hypot(a.sx - b.sx, a.sy - b.sy));
      }
    }
    return min;
  };
  const launch = () => {
    let best = null,
      bestGap = -1;
    for (let k = 0; k < 10 && bestGap < T * 1.15; k++) {
      const a = rnd() * 2 * Math.PI,
        tilt = rad(18 + rnd() * 24),
        apex = 55 + rnd() * 65,
        vz = Math.sqrt(2 * G * apex),
        vh = vz * Math.tan(tilt);
      const c = {
        x0: WT + (0.12 + 0.76 * rnd()) * (D - 2 * WT),
        y0: WT + (0.12 + 0.76 * rnd()) * (D - 2 * WT),
        z0: H,
        vx: vh * Math.cos(a),
        vy: vh * Math.sin(a),
        vz,
        ax: (rnd() * 2 - 1) * 0.15 * G,
        ay: (rnd() * 2 - 1) * 0.15 * G,
      };
      const d = gap(c);
      if (d > bestGap) {
        best = c;
        bestGap = d;
      }
    }
    pieces.push({
      ...build(nextKind()),
      ...best,
      age: 0,
      wob: rnd() * 6.28,
      fixed: false,
    });
    kick.v += 30 + rnd() * 12;
  };
  // Rest pose: five logos already in the air, spread left, above and right.
  const place = (kind, sx, sy, z) => {
    const [x, y] = unproj(C, sx, sy, z);
    pieces.push({
      ...build(kind),
      x0: x,
      y0: y,
      z0: z,
      vx: 0,
      vy: 0,
      vz: 0,
      ax: 0,
      ay: 0,
      age: 0,
      wob: 0,
      fixed: true,
    });
  };
  place('ts', 96, 168, H + 40);
  place('react', 150, 108, H + 70);
  place('rspack', 214, 82, H + 90);
  place('chrome', 276, 118, H + 66);
  place('vue', 318, 174, H + 36);

  const rate = spring(1, { k: 90, c: 18 });
  const B = register(stage, (dt) => {
    stepS(rate, dt);
    const sdt = playing || over ? dt * CLOCK * clamp(rate.x, 0.02, 1.5) : 0;
    if (sdt > 0) {
      // Once time runs, the rest pose joins the flight: each piece falls from where it hangs.
      for (const o of pieces)
        if (o.fixed) Object.assign(o, { fixed: false, vz: 25 + 40 * rnd() });
      pop -= sdt;
      if (pop <= 0 && pieces.length < CAP) {
        launch();
        pop = POP * (0.8 + 0.5 * rnd());
      }
    }
    stepS(kick, sdt);
    drawFlaps();
    for (let i = pieces.length - 1; i >= 0; i--) {
      const o = pieces[i];
      if (!o.fixed) o.age += sdt;
      const s = o.fixed ? { ...at(o, 0), down: false } : at(o, o.age);
      Object.assign(o, { x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy });
      // Fade in over 90ms; on the way down fade out so it is gone before the rim.
      const born = o.fixed ? 1 : Math.min(1, o.age / 0.09),
        sink = s.down ? clamp((mouthY - 16 - s.sy) / 44, 0, 1) : 1;
      if (offStage(s) || (s.down && sink <= 0)) {
        o.g.remove();
        pieces.splice(i, 1);
        continue;
      }
      o.g.setAttribute(OP, (born * sink).toFixed(3));
      const tilt = o.fixed ? 0 : 9 * Math.sin(o.age * 2.2 + o.wob);
      o.g.setAttribute(
        'transform',
        `translate(${s.sx.toFixed(1)} ${s.sy.toFixed(1)}) rotate(${tilt.toFixed(1)})`,
      );
    }
    // Depth order: farther pieces first.
    pieces
      .slice()
      .sort((a, b) => a.x + a.y - (b.x + b.y))
      .forEach((o) => airG.appendChild(o.g));
    let lit = -1,
      best = 1e9;
    pieces.forEach((o, i) => {
      const d = over ? Math.hypot(o.sx - ptr[0], o.sy - ptr[1]) : -o.z;
      if (d < best) {
        best = d;
        lit = i;
      }
    });
    pieces.forEach((o, i) => o.face.classList.toggle('hi', i === lit));
    const name = over && lit >= 0 ? pieces[lit].kind : 'rest';
    if (read.textContent !== name) read.textContent = name;
    return true;
  });
  bag.add(B.unregister);
  bag.add(
    pointer(stage, {
      move: (p, e) => {
        if (e?.pointerType === 'ghost') {
          playing = true;
          return;
        }
        over = true;
        ptr = p;
        rate.t = slow;
        B.wake();
      },
      leave: (e) => {
        if (e?.pointerType === 'ghost') {
          playing = true;
          return;
        }
        over = false;
        rate.t = 1;
        B.wake();
      },
    }),
  );
  bag.add(() => svg.replaceChildren());
  return {
    set: (v) => {
      slow = clamp(v, 0.02, 1);
      if (over) rate.t = slow;
    },
    destroy: bag.dispose,
  };
}

const MEANS =
  'A box keeps popping the tools Rstest works with: TypeScript, React, Vue, Sass, Playwright, the browsers and the Rstack. Hovering slows it.';

/** Mounts the figure in `host` the way the package does. It plays by default, unless the reader asked for less motion. Returns the tear-down. */
export function mountPopper(host, { value = 0.2, play = true } = {}) {
  const doc = host.ownerDocument;
  HL.inject(doc);
  host.setAttribute('data-hairline', 'popper');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', MEANS);
  const svg = HL.mk(
    'svg',
    { viewBox: '0 0 400 320', 'aria-hidden': 'true' },
    host,
  );
  const figure = mount(
    { stage: host, svg, read: { textContent: '' } },
    value,
    play &&
      !doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return () => {
    figure.destroy();
    svg.remove();
    for (const name of ['data-hairline', 'role', 'aria-label'])
      host.removeAttribute(name);
  };
}

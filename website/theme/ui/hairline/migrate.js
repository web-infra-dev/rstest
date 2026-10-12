import { HL } from './kernel.js';

/**
 * Migrate: two bins, the Jest mark raised on one front and the Rstest mark on
 * the other, with the same six slots. The pointer's x sets how many test files
 * have moved: each one lifts out of its Jest slot, crosses, and drops into the
 * same slot in the Rstest bin, unchanged, one after another. At rest the move
 * is half done. The slider is the stagger between files, in ms.
 */
const {
  Cam,
  clamp,
  facing,
  fillet,
  fit,
  hull,
  lerp,
  open,
  poly,
  proj,
  rad,
  ringAt,
  rrect,
  run,
  seg,
  tset,
  tval,
  tdone,
  tween,
  disposer,
  mk,
  pointer,
  register,
} = HL;

const N = 6,
  W = 56,
  H = 40,
  G = 11,
  TW = 16,
  TH = 6,
  TABS = [5, 20, 35],
  TK = 1.3,
  LEAN = -12;
const X0 = -5,
  X1 = W + 5,
  Y0 = -8,
  Y1 = (N - 1) * G + 8,
  WH = 30,
  WR = 6,
  WT = 2.4;
// One colour per file, for its light. This breaks rule 04 on purpose: the homepage asked for it.
const LIGHTS = [
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#ec4899',
];
// A file's trip takes twice the kernel's 700ms, so each one can be followed across.
const FLY = 1400;
// Each card line's class when unpowered and when powered: [part, off, on].
const STEPS = [
  ['back', 'lo', ''],
  ['face', 'sil', 'hi'],
  ['head', 'nf', 'nf sil'],
  ['rules', 'nf lo', 'nf'],
];
// The power-up flicker of a file landing in the Rstest bin: [ms after touchdown, on]. The last entry holds.
const FLICKER = [
  [0, 1],
  [80, 0],
  [200, 1],
];
const JX = -100,
  LIFT = 36,
  REST_K = 4,
  RELIEF = 1.2;

// The Jest mark, from its own svg (viewBox 1024 × 768): the hat, three bells, and the tail sampled along its path.
const J_HAT = [
  [276, 173],
  [514, 173],
  [449, 365],
  [395, 254],
  [341, 365],
];
const J_BELLS = [195, 329, 463].map((cx) =>
  Array.from({ length: 20 }, (_, k) => [
    cx + 41 * Math.cos((k / 20) * 2 * Math.PI),
    380 + 41 * Math.sin((k / 20) * 2 * Math.PI),
  ]),
);
const J_TAIL = [
  [465, 381],
  [425, 377],
  [385, 376],
  [344, 375],
  [324, 406],
  [302, 440],
  [274, 469],
  [240, 490],
  [207, 477],
  [198, 438],
  [211, 400],
  [186, 386],
  [168, 422],
  [151, 459],
  [141, 498],
  [144, 538],
  [165, 573],
  [201, 591],
  [241, 590],
  [279, 578],
  [316, 560],
  [352, 543],
  [391, 530],
  [431, 523],
  [469, 512],
  [499, 484],
  [508, 446],
  [496, 408],
];
// The Rstest mark, traced from its svg (viewBox 217 × 200) and smoothed: the crab's silhouette, then a few inner lines.
const R_SIL = [
  [66, -1],
  [78, 1],
  [88, 6],
  [95, 14],
  [101, 22],
  [103, 26],
  [102, 28],
  [104, 28],
  [106, 30],
  [107, 50],
  [106, 54],
  [102, 56],
  [104, 58],
  [103, 61],
  [99, 68],
  [93, 72],
  [92, 73],
  [89, 71],
  [88, 68],
  [90, 65],
  [83, 69],
  [82, 72],
  [82, 75],
  [85, 78],
  [90, 82],
  [97, 85],
  [100, 85],
  [106, 80],
  [113, 78],
  [113, 76],
  [107, 73],
  [106, 71],
  [106, 69],
  [113, 59],
  [121, 51],
  [132, 45],
  [145, 38],
  [155, 37],
  [163, 38],
  [164, 39],
  [164, 42],
  [161, 46],
  [157, 51],
  [155, 53],
  [156, 54],
  [166, 59],
  [169, 63],
  [169, 66],
  [168, 69],
  [160, 81],
  [160, 84],
  [161, 87],
  [166, 90],
  [170, 99],
  [172, 101],
  [181, 103],
  [192, 102],
  [200, 103],
  [207, 108],
  [213, 115],
  [216, 123],
  [216, 131],
  [213, 140],
  [210, 144],
  [204, 150],
  [198, 153],
  [189, 156],
  [189, 157],
  [198, 165],
  [200, 168],
  [198, 170],
  [183, 174],
  [182, 182],
  [178, 192],
  [175, 196],
  [171, 198],
  [165, 198],
  [158, 196],
  [140, 193],
  [117, 193],
  [94, 194],
  [58, 200],
  [54, 199],
  [52, 196],
  [53, 187],
  [47, 198],
  [45, 199],
  [41, 200],
  [37, 198],
  [34, 194],
  [34, 180],
  [31, 176],
  [28, 175],
  [22, 176],
  [14, 181],
  [10, 182],
  [8, 176],
  [8, 169],
  [11, 162],
  [11, 158],
  [10, 154],
  [3, 135],
  [2, 129],
  [1, 115],
  [2, 108],
  [7, 96],
  [15, 85],
  [20, 81],
  [37, 70],
  [39, 67],
  [39, 65],
  [34, 56],
  [31, 47],
  [33, 54],
  [34, 61],
  [33, 63],
  [30, 65],
  [28, 65],
  [26, 62],
  [23, 53],
  [21, 45],
  [21, 37],
  [23, 33],
  [31, 17],
  [40, 8],
  [51, 2],
];
// lightning, the big claw, the small claw, two eyes, the gauge's ball
const R_LINES = [
  [
    [148, 44],
    [135, 49],
    [123, 56],
    [114, 65],
    [112, 70],
    [113, 71],
    [120, 73],
    [142, 76],
    [143, 76],
    [139, 81],
    [138, 86],
    [138, 87],
    [144, 86],
    [149, 84],
    [156, 78],
    [162, 70],
    [164, 64],
    [164, 63],
    [162, 61],
    [150, 59],
    [147, 58],
    [147, 56],
    [149, 53],
    [156, 45],
    [159, 42],
    [156, 41],
  ],
  [
    [56, 137],
    [42, 142],
    [36, 146],
    [37, 149],
    [40, 151],
    [39, 147],
    [40, 145],
    [42, 144],
    [43, 148],
    [41, 159],
    [39, 163],
    [37, 166],
    [34, 167],
    [24, 162],
    [19, 158],
    [14, 151],
    [7, 135],
    [5, 119],
    [7, 103],
    [12, 95],
    [19, 87],
    [27, 80],
    [39, 74],
    [48, 73],
    [62, 73],
    [72, 76],
    [85, 83],
    [96, 93],
    [99, 95],
    [100, 100],
    [95, 104],
    [78, 111],
    [74, 114],
    [72, 118],
    [73, 125],
    [71, 129],
  ],
  [
    [169, 115],
    [168, 124],
    [170, 134],
    [174, 143],
    [177, 148],
    [185, 150],
    [195, 150],
    [198, 149],
    [205, 144],
    [207, 141],
    [207, 138],
    [204, 137],
    [199, 138],
    [195, 138],
    [186, 132],
    [175, 128],
    [174, 126],
    [176, 127],
    [181, 129],
    [188, 130],
    [199, 137],
    [203, 134],
    [211, 134],
    [213, 131],
    [213, 126],
    [212, 120],
    [210, 115],
    [206, 111],
    [202, 108],
    [193, 106],
    [183, 105],
    [174, 107],
    [172, 109],
  ],
  [
    [109, 84],
    [106, 85],
    [105, 89],
    [107, 91],
    [111, 91],
    [115, 93],
    [117, 100],
    [117, 107],
    [114, 112],
    [109, 116],
    [105, 116],
    [100, 114],
    [99, 115],
    [97, 119],
    [99, 122],
    [105, 124],
    [112, 124],
    [118, 120],
    [124, 109],
    [125, 104],
    [126, 93],
    [125, 89],
    [123, 86],
    [120, 84],
  ],
  [
    [137, 112],
    [137, 116],
    [139, 118],
    [141, 120],
    [144, 120],
    [147, 119],
    [149, 116],
    [151, 109],
    [151, 105],
    [150, 102],
    [147, 100],
    [144, 100],
    [142, 101],
    [139, 104],
  ],
  [
    [67, 52],
    [71, 50],
    [73, 47],
    [74, 41],
    [73, 37],
    [71, 34],
    [68, 33],
    [61, 34],
    [57, 37],
    [55, 42],
    [55, 45],
    [58, 49],
    [64, 53],
    [68, 53],
    [73, 50],
    [76, 46],
    [76, 39],
    [72, 33],
    [69, 32],
    [64, 31],
    [58, 33],
    [55, 36],
    [54, 39],
    [55, 48],
    [57, 51],
    [59, 52],
    [61, 53],
  ],
];

const LR = (pts) =>
  pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse();
const ease = (u) => {
  const v = clamp(u, 0, 1);
  return v * v * (3 - 2 * v);
};

/** An open bin at x offset dx, which never moves: `far` is painted before its cards, `near` after; each entry is [d, class]. */
function bin(P, front, dx) {
  const outer = rrect(X0 + dx, Y0, X1 + dx, Y1, WR, 6),
    inner = rrect(X0 + WT + dx, Y0 + WT, X1 - WT + dx, Y1 - WT, WR - WT, 6);
  const iF = LR(ringAt(P, run(inner, front), WH)),
    oT = LR(ringAt(P, run(outer, front), WH)),
    oB = LR(ringAt(P, run(outer, front), 0));
  return {
    far: [
      [poly(hull(ringAt(P, outer, 0).concat(ringAt(P, outer, WH)))), 'sil'],
      [poly(ringAt(P, inner, WH)), 'nf'],
      [
        open(
          ringAt(
            P,
            run(inner, (q) => !front(q)),
            2.5,
          ),
        ),
        'nf lo',
      ],
    ],
    near: [
      [poly([...iF, oT[oT.length - 1], ...oB.slice().reverse(), oT[0]]), 'fo'],
      [open(oT), 'nf lo'],
      [open(iF), 'nf'],
      [open([oT[0], ...oB, oT[oT.length - 1]]), 'nf sil'],
    ],
  };
}

/**
 * A mark raised on a bin's front wall: each plate's foot dim on the wall, its top filled in front of it, then its
 * inner lines. `box` is the mark's own [u0, v0, u1, v1]; it is fitted to `h` world units tall.
 */
function mark(g, P, dx, box, h, plates, lines) {
  const k = h / (box[3] - box[1]),
    uc = (box[0] + box[2]) / 2,
    vc = (box[1] + box[3]) / 2;
  const at =
    (y) =>
    ([u, v]) =>
      P((X0 + X1) / 2 + dx + (u - uc) * k, y, WH / 2 - (v - vc) * k);
  plates.forEach((pts) => {
    mk('path', { d: poly(pts.map(at(Y1))), class: 'nf lo' }, g);
    mk('path', { d: poly(pts.map(at(Y1 + RELIEF))) }, g);
  });
  lines.forEach((pts) =>
    mk('path', { d: poly(pts.map(at(Y1 + RELIEF))), class: 'nf' }, g),
  );
}

/** Card i at journey m (0 in its Jest slot, 1 in its Rstest slot): up out of the bin, across, and down. */
function pose(P, i, m) {
  const t0 = TABS[i % 3],
    yb = i * G,
    s = Math.sin(rad(LEAN)),
    c = Math.cos(rad(LEAN));
  const dx = lerp(JX, 0, ease((m - 0.3) / 0.4)),
    dz = LIFT * Math.min(ease(m / 0.3), ease((1 - m) / 0.3));
  const shape = fillet(
    [
      [0, 0],
      [W, 0],
      [W, H],
      [t0 + TW, H],
      [t0 + TW, H + TH],
      [t0, H + TH],
      [t0, H],
      [0, H],
    ],
    [1, 1, 3, 1.6, 2.2, 2.2, 1.6, 3],
  );
  const w = (u, v) => P(u + dx, yb + v * s, v * c + dz + 2.5);
  const wb = (u, v) =>
    P(u + dx, yb + v * s - TK * c, v * c + TK * s + dz + 2.5);
  return {
    dx,
    dz,
    back: poly(shape.map((p) => wb(p[0], p[1]))),
    face: poly(shape.map((p) => w(p[0], p[1]))),
    head: seg(w(5, H - 9), w(W - 5, H - 9)),
    rules: [H - 15, H - 21, H - 27]
      .map((v) => seg(w(5, v), w(W - 14 - v / 4, v)))
      .join(''),
    // the light is a disc in the card's own plane, centred on the tab
    tab: poly(
      Array.from({ length: 16 }, (_, j) =>
        w(
          t0 + TW / 2 + 1.4 * Math.cos((j / 16) * 2 * Math.PI),
          H + TH / 2 - 1 + 1.4 * Math.sin((j / 16) * 2 * Math.PI),
        ),
      ),
    ),
  };
}

const MEANS =
  'Test files moved from the Jest bin to the Rstest bin one at a time, unchanged.';

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;

  const S = 1.42,
    C = Cam(45, 0.5, S);
  fit(
    C,
    [
      [X0 + JX, Y1, 0],
      [X0 + JX, Y0, WH],
      [X1, Y1, 0],
      [X1, Y0, WH],
      [JX / 2, Y0, LIFT + H + TH],
      [W + JX / 2, Y0, LIFT + H + TH],
    ],
    200,
    166,
  );
  const P = proj(C),
    front = facing(C);

  // Each bin: its far half, a layer its cards live in, and its near half with the mark. The Jest bin is the farther.
  const layer = {};
  for (const [id, dx] of [
    ['jest', JX],
    ['rstest', 0],
  ]) {
    const g = mk('g', {}, svg),
      paths = bin(P, front, dx);
    for (const [d, cls] of paths.far) mk('path', { d, class: cls }, g);
    layer[id] = mk('g', {}, g);
    for (const [d, cls] of paths.near) mk('path', { d, class: cls }, g);
    if (id === 'jest')
      mark(
        g,
        P,
        dx,
        [142, 173, 514, 591],
        17,
        [
          fillet(
            J_HAT,
            J_HAT.map(() => 10),
          ),
          J_TAIL,
          ...J_BELLS,
        ],
        [],
      );
    else mark(g, P, dx, [0, -2, 217, 200], 18, [R_SIL], R_LINES);
  }

  // Card i moves when it is among the first k from the front: the nearest card goes first.
  const moved = (i, k) => N - 1 - i < k;
  const cards = Array.from({ length: N }, (_, i) => {
    const grp = mk('g', {}, layer.jest);
    return {
      grp,
      side: 'jest',
      m: tween(moved(i, REST_K) ? 1 : 0, FLY),
      back: mk('path', { class: 'lo' }, grp),
      face: mk('path', { class: 'sil' }, grp),
      head: mk('path', { class: 'nf' }, grp),
      rules: mk('path', { class: 'nf lo' }, grp),
      tab: mk('path', { class: 'dot off' }, grp),
    };
  });
  // the kernel fades strokes and dots over 260ms, which would blur the power-up blinks into one
  for (const cd of cards)
    for (const el of [cd.back, cd.face, cd.head, cd.rules])
      el.style.transition = 'none';

  /** Puts card i in the layer of the bin it is over, in slot order, once it is high enough to cross a wall. */
  function file(i, dx) {
    const cd = cards[i],
      side = dx + W > X0 ? 'rstest' : 'jest';
    if (side === cd.side) return;
    cd.side = side;
    const next = cards.slice(i + 1).find((o) => o.side === side);
    layer[side].insertBefore(cd.grp, next ? next.grp : null);
  }

  let k = -1;
  // seat[i]: the bin card i has come down in, judged from its pose rather than the end of its tween, whose ease-out tail is long
  const drawn = cards.map(() => null),
    seat = [],
    was = [],
    chargeAt = [],
    shown = [];
  /**
   * Each file's power. In the Jest bin its light is on at once. Landing in the Rstest bin its light comes on too, and
   * the card's bright edge blinks once, like a supply being connected, then holds on.
   * In the air everything is off. Returns whether a flicker is still running.
   */
  function power(now) {
    let charging = false;
    cards.forEach((cd, i) => {
      if (seat[i] !== was[i]) {
        // a file already in the Rstest bin when the figure mounts starts powered
        chargeAt[i] =
          seat[i] === 'rstest'
            ? was[i] === undefined
              ? -Infinity
              : now
            : null;
        was[i] = seat[i];
      }
      const t = chargeAt[i] === null ? -1 : now - chargeAt[i];
      if (t >= 0 && t < FLICKER[FLICKER.length - 1][0]) charging = true;
      const lit = t >= 0 && FLICKER.filter(([at]) => at <= t).pop()[1];
      // the light comes on as the file lands in either bin; only the edge flickers
      const on = seat[i] !== null,
        full = seat[i] === 'rstest' && lit;
      const key = `${on}|${full}`;
      if (shown[i] === key) return;
      shown[i] = key;
      cd.tab.setAttribute('class', on ? 'dot' : 'dot off');
      cd.tab.style.fill = on ? LIGHTS[i] : '';
      // a powered card steps every line up one level of the palette (lo, mid, edge, hi), so they keep their order
      for (const [key, off, lit] of STEPS)
        cd[key].setAttribute('class', full ? lit : off);
    });
    return charging;
  }
  const B = register(stage, (_dt, now) => {
    let moving = false;
    cards.forEach((cd, i) => {
      const m = tval(cd.m, now);
      if (!tdone(cd.m, now)) moving = true;
      if (m === drawn[i]) return;
      drawn[i] = m;
      const q = pose(P, i, m);
      for (const key of ['back', 'face', 'head', 'rules'])
        cd[key].setAttribute('d', q[key]);
      cd.tab.setAttribute('d', q.tab);
      file(i, q.dx);
      seat[i] = q.dz > 0.5 ? null : q.dx > JX / 2 ? 'rstest' : 'jest';
    });
    return power(now) || moving;
  });
  bag.add(B.unregister);

  // Where each file sits in the Jest bin at rest, on screen. The pointer sweeping right past a file's spot sends it
  // over, so the front file (leftmost) goes first; past the last one, all have moved. The spots never move.
  const spot = cards.map(
    (_, i) =>
      P(
        JX + W / 2,
        i * G + (H / 2) * Math.sin(rad(LEAN)),
        (H / 2) * Math.cos(rad(LEAN)) + 2.5,
      )[0],
  );
  /** Moves the first k cards over (or back), staggered out from the card at the boundary; `touch` says whether a hand set it. */
  function setCount(next, touch) {
    read.textContent = touch ? `jest ${N - next} · rstest ${next}` : 'rest';
    if (next === k) return;
    const now = performance.now(),
      edge = N - Math.max(next, k, 0);
    k = next;
    cards.forEach((cd, i) => {
      tset(cd.m, moved(i, k) ? 1 : 0, now, Math.abs(i - edge) * stag);
    });
    B.wake();
  }
  setCount(REST_K, false);

  bag.add(
    pointer(stage, {
      move: (p) => setCount(spot.filter((x) => p[0] >= x).length, true),
      leave: () => setCount(REST_K, false),
    }),
  );
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => {
      stag = v;
    },
    destroy: bag.dispose,
  };
}

/** Mounts the figure in `host` the way the package does, with a fixed stagger, and plays its tour when asked. Returns the tear-down. */
export function mountMigrate(host, { stagger = 400, play = true } = {}) {
  HL.inject(host.ownerDocument);
  host.setAttribute('data-hairline', 'migrate');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', MEANS);
  const svg = HL.mk(
    'svg',
    { viewBox: '0 0 400 320', 'aria-hidden': 'true' },
    host,
  );
  const figure = mount(
    { stage: host, svg, read: { textContent: '' } },
    stagger,
  );
  // spots sit at x 126 to 182: two files over, then all six, then none, then back to rest
  const lap = play
    ? HL.tour(host, [[143, 152], [215, 175], [222, 182], [110, 160], null])
    : null;
  return () => {
    lap?.stop();
    figure.destroy();
    svg.remove();
    for (const name of ['data-hairline', 'role', 'aria-label'])
      host.removeAttribute(name);
  };
}

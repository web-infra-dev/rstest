import { HL } from './kernel.js';

/**
 * Belt: crates of different kinds of test ride one belt out of a hood, under
 * one stamping press that stamps the rstest mark on each lid in turn, and into
 * a hood at the far end. Each crate's near side carries its kind: the Node.js
 * mark for a unit test, a test tube for DOM, the Chrome mark for browser mode,
 * the Playwright masks for Playwright. The belt never stops; hovering only slows its clock so a crate
 * can be read, and the crate under the press is bright. The slider is the hovered rate.
 */
const {
  Cam,
  clamp,
  fillet,
  fit,
  hull,
  open,
  poly,
  prism,
  proj,
  rings,
  run,
  seg,
  facing,
  spring,
  stepS,
  disposer,
  mk,
  pointer,
  put,
  register,
  solid,
} = HL;

// the belt runs along x from 0 to BL; the hoods' faces are at H0 and H1
const BL = 220,
  BW = 24,
  BZ = 6,
  H0 = 24,
  H1 = 196,
  HH = 32,
  GX = 110,
  SPEED = 26,
  CW = 10,
  CI = 3.5; // a crate is 2·CW long and stands CI in from each edge of the belt
// Side labels carry a picture of each kind, against rule 10 on purpose: the homepage asked for them.
const KINDS = [
  ['unit', 16],
  ['playwright', 16],
  ['dom', 16],
  ['browser', 16],
  ['unit', 16],
  ['playwright', 16],
];
const N = KINDS.length,
  GAP = BL / N;
const ellipse = (cu, cv, ru, rv, n = 16) =>
  Array.from({ length: n }, (_, k) => [
    cu + ru * Math.cos((k / n) * 2 * Math.PI),
    cv + rv * Math.sin((k / n) * 2 * Math.PI),
  ]);
// each mark in the near side's own frame (u along the belt, v down): [points, class, closed]
const MARKS = {
  // the Node.js mark traced along its strokes' centre lines, from its 24-unit icon: the hexagon, the J and the S
  unit: [
    [
      fillet(
        [
          [0, -11.4],
          [9.9, -5.7],
          [9.9, 5.7],
          [0, 11.4],
          [-9.9, 5.7],
          [-9.9, -5.7],
        ],
        [1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
      ),
      'nf',
      true,
    ],
    [
      [
        [-4, -4.2],
        [-4, 6],
        [-4.7, 7.4],
        [-6, 7.6],
        [-7.2, 7],
      ],
      'nf',
      false,
    ],
    [
      [
        [6.2, -1.6],
        [5.2, -3.4],
        [3, -3.8],
        [0.8, -3.4],
        [0.3, -2.1],
        [1, -1],
        [3.2, -0.4],
        [6, 0.3],
        [6.5, 2],
        [5.5, 3.6],
        [3, 4.2],
        [0.5, 3.6],
        [-0.4, 2.2],
      ],
      'nf',
      false,
    ],
  ].map(([pts, cls, closed]) => [
    pts.map(([u, v]) => [u * 0.55, v * 0.55]),
    cls,
    closed,
  ]),
  // Lucide's diagonal test tube, from its 24-unit icon: the tube with its round end, the lip, the liquid line
  dom: [
    [
      [9, -5],
      ...[45, 90, 135, 180, 225].map((t) => [
        -7.17 + 2.83 * Math.cos((t * Math.PI) / 180),
        7.17 + 2.83 * Math.sin((t * Math.PI) / 180),
      ]),
      [5, -9],
    ],
    [
      [4, -10],
      [10, -4],
    ],
    [
      [0, 4],
      [-8, 4],
    ],
  ].map((pts) => [pts.map(([u, v]) => [u * 0.55, v * 0.55]), 'nf', false]),
  // traced from the official Playwright logo: the red mask behind, the green mask over it; the plain class fills a
  // mask with the plate, so the green one hides the part of the red one it covers
  playwright: [
    [
      [
        [-1.37, 2.38],
        [-1.43, 1.54],
        [-3.75, 2.17],
        [-3.4, 1.49],
        [-2.81, 1.01],
        [-1.37, 0.73],
        [-1.37, -2.64],
        [-1.33, -2.75],
        [-0.2, -2.82],
        [-0.63, -3.8],
        [-0.9, -3.78],
        [-2.28, -2.83],
        [-3.57, -2.36],
        [-4.78, -2.2],
        [-6.44, -2.3],
        [-6.42, -1.4],
        [-5.88, 0.51],
        [-5.17, 1.86],
        [-4.48, 2.68],
        [-3.46, 3.33],
        [-2.4, 3.47],
        [-1.37, 3.2],
        [-0.63, 2.67],
        [-0.46, 2.38],
      ],
      '',
      true,
    ],
    [
      [
        [-5.22, -0.44],
        [-3.41, -0.92],
        [-3.61, -0.37],
        [-4.12, -0.04],
        [-4.73, -0.07],
      ],
      'nf',
      true,
    ],
    [
      [
        [5.51, -2.7],
        [3.98, -2.64],
        [2.18, -2.98],
        [0.5, -3.73],
        [-0.85, -4.73],
        [-1.13, -4.68],
        [-2.0, -2.23],
        [-2.29, 0.19],
        [-2.02, 2.16],
        [-1.66, 3.01],
        [-1.11, 3.74],
        [0.18, 4.54],
        [1.54, 4.76],
        [2.73, 4.48],
        [3.86, 3.72],
        [5.08, 2.15],
        [6.16, -0.54],
        [6.49, -2.65],
        [6.26, -2.82],
      ],
      '',
      true,
    ],
    [
      [
        [-1.19, -1.04],
        [-0.62, -1.53],
        [0.12, -1.63],
        [0.88, -1.17],
        [1.17, -0.47],
      ],
      'nf',
      true,
    ],
    [
      [
        [2.47, 0.06],
        [3.04, -0.44],
        [3.93, -0.49],
        [4.54, -0.06],
        [4.81, 0.72],
      ],
      'nf',
      true,
    ],
    [
      [
        [0.98, 2.62],
        [-0.2, 1.96],
        [-0.82, 0.94],
        [3.38, 2.1],
        [2.33, 2.68],
      ],
      'nf',
      true,
    ],
  ],
  // the Chrome icon traced as lines: the outer ring, the inner circle, and the three edges between its sectors,
  // each tangent to the inner circle and turned 120° from the last
  browser: [
    [ellipse(0, 0, 5.5, 5.5, 28), 'nf', true],
    [ellipse(0, 0, 2.3, 2.3, 16), 'nf', true],
    ...[-90, 30, 150].map((t) => {
      const c = Math.cos((t * Math.PI) / 180),
        s = Math.sin((t * Math.PI) / 180),
        L = Math.sqrt(5.5 ** 2 - 2.3 ** 2);
      return [
        [
          [2.3 * c, 2.3 * s],
          [2.3 * c - L * s, 2.3 * s + L * c],
        ],
        'nf',
        false,
      ];
    }),
  ],
};
const ICON = (kind) =>
  MARKS[kind].map(([pts, cls, closed]) => [
    pts.map(([u, v]) => [u * 0.75, v * 0.75]),
    cls,
    closed,
  ]); // the icon alone, no label
// the opening cut in a hood's end, in the (y, z) plane: no frame, rounded all round, an even margin M around the crates; M = CI - 0.5 makes it as wide as the belt's top, so the belt's sides run on into the opening's edges
const M = CI - 0.5,
  TALL = Math.max(...KINDS.map(([, h]) => h));
const HOLE = fillet(
  [
    [CI - M, BZ - M],
    [BW - CI + M, BZ - M],
    [BW - CI + M, BZ + TALL + M],
    [CI - M, BZ + TALL + M],
  ],
  [3, 3, 3, 3],
);

// the stamp, flat on the lid (x along the belt, y across) and read from the near side: a scalloped rim and a thick tick, which the page fills solid (data-stamp="tick")
const STAMP = [
  [
    Array.from({ length: 140 }, (_, k) => {
      const a = (k / 140) * 2 * Math.PI,
        r = 3.8 + 0.2 * Math.cos(9 * a);
      return [r * Math.cos(a), r * Math.sin(a)];
    }),
    true,
  ],
  [
    fillet(
      [
        [-2.86, -0.25],
        [-2.64, -0.45],
        [-0.9, 1.33],
        [2.09, -1.78],
        [2.31, -1.58],
        [-0.9, 1.77],
      ].map(([a, b]) => [a * 0.75, b * 0.75]),
      [0.05, 0.05, 0.03, 0.05, 0.05, 0.05],
    ),
    true,
  ],
];
// the press: a column behind the belt, an arm over it to a cylinder above the belt's centre line YC;
// its head rests with its face at FOOT and comes down onto a lid as a crate's centre passes GX, over PRESS either side
const YC = BW / 2,
  CYL = 38,
  FOOT = CYL - 5,
  PRESS = 9,
  ARM = 46;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let slow = value,
    over = false,
    phase = 0;
  const C = Cam(45, 0.5, 1.5);
  fit(
    C,
    [
      [-4, -10, 0],
      [BL + 4, BW + 10, 0],
      [BL + 4, -10, 0],
      [-4, BW + 10, 0],
      [-4, -6, HH],
      [BL + 4, BW + 6, HH],
      [GX, -21, ARM + 6],
      [GX, YC + 8, ARM + 6],
    ],
    200,
    166,
  );
  const P = proj(C),
    front = facing(C);
  const g = mk('g', {}, svg);
  const block = (x0, y0, x1, y1, r, b, z0, z1) =>
    put(solid(g), prism(P, front, ...rings(x0, y0, x1, y1, r, b), z0, z1));
  // back to front: the press's base and column; the belt's frame, its belt and moving slats; the left hood;
  // the crates; the press's head, rod, cylinder with its lamp, and arm; the right hood
  block(GX - 10, -22, GX + 10, -5, 3, 1, 0, 2.5);
  block(GX - 5, -18, GX + 5, -8, 4, 1.2, 2.5, ARM);
  put(solid(g), {
    sil: prism(P, front, ...rings(0, -2, BL, BW + 2, 10, 1.5), 0, BZ - 1.5).sil,
    crease: '',
  }); // no crease: it ran beside the belt's edge
  block(1, 0.5, BL - 1, BW - 0.5, 9, 1, BZ - 1.5, BZ);
  // crates inside the left hood are drawn before it, and the opening is cut out of the hood's silhouette as a
  // reverse-wound ring, so they show through the opening and nowhere else
  mk(
    'path',
    {
      d: seg(P(H0, CI + 3 - M, BZ - M), P(H0 - 8, CI + 3 - M, BZ - M)),
      class: 'nf lo',
    },
    g,
  ); // the opening's floor edge, behind the crates inside
  const inside = mk('g', {}, g);
  const hood = prism(P, front, ...rings(-4, -6, H0, BW + 6, 6, 1.5), 0, HH);
  const area = (pts) =>
    pts.reduce((a, [x, y], i) => {
      const [u, v] = pts[(i + 1) % pts.length];
      return a + x * v - u * y;
    }, 0);
  const nums = hood.sil.match(/-?[\d.]+/g).map(Number),
    outline = nums.flatMap((n, i) => (i % 2 ? [] : [[n, nums[i + 1]]]));
  const cutPts = HOLE.map(([y, z]) => P(H0, y, z));
  put(solid(g), {
    sil:
      hood.sil +
      poly(
        Math.sign(area(cutPts)) === Math.sign(area(outline))
          ? cutPts.reverse()
          : cutPts,
      ),
    crease: hood.crease,
  });
  // the belt again in front of the hood's face, cut at it, so it hides the opening's lower edge where it runs below the belt
  const beltFront = mk('g', {}, g),
    slats = mk('path', { class: 'nf lo' }, g);
  const layer = mk('g', {}, g);
  const head = solid(g),
    rod = solid(g);
  block(GX - 7, YC - 7, GX + 7, YC + 7, 7, 1.2, CYL, ARM);
  // the lamp on the cylinder's front, facing along the belt's width
  const onFace = (pts) => pts.map(([u, v]) => P(GX + u, YC + 7, ARM - 4 + v));
  const lamp = mk(
    'path',
    { d: poly(onFace(ellipse(0, 0, 1.4, 1.4, 12))), class: 'nf lo' },
    g,
  );
  block(GX - 5, -18, GX + 5, YC + 9, 4, 1.2, ARM, ARM + 6);
  block(H1, -6, BL + 4, BW + 6, 6, 1.5, 0, HH);
  // a crate is drawn as two parts, each cut at a plane x and outlined without the cut: the part in front of the hood's
  // face, and the copy inside the hood seen through the opening, which starts DEEP behind the face so it slides into view
  const part = (parent) => {
    const pg = mk('g', {}, parent),
      fill = mk('path', { class: 'fo' }, pg),
      sol = solid(pg);
    sol.sil.classList.add('nf');
    return { g: pg, fill, sol, face: mk('g', {}, pg) };
  };
  const crates = KINDS.map(([kind, h], i) => {
    const grp = mk('g', {}, layer),
      fore = part(grp),
      stamp = STAMP.map((_, k) =>
        mk('path', { class: 'nf', 'data-stamp': k ? 'tick' : 'pass' }, grp),
      ),
      back = part(inside);
    [fore, back].forEach((pt) => {
      pt.marks = ICON(kind).map(([pts, cls, closed]) => ({
        pts,
        closed,
        area: cls ? null : mk('path', { class: 'fo' }, pt.face),
        edge: mk('path', { class: cls || 'nf' }, pt.face),
      }));
    });
    return { kind, h, s0: i * GAP, grp, fore, back, stamp };
  });
  const rate = spring(1);
  // a crate wraps from inside the right hood to x = -4, its near face then past DEEP, which the opening never shows
  const cxOf = (c) => ((((c.s0 + phase) % BL) + BL) % BL) - 4;
  const onSide =
    (cx, cz) =>
    ([u, v]) =>
      P(cx + u, BW - CI, cz - v);
  const L = H0,
    R = H1,
    DEEP = 18;
  // a crate's footprint with its corners always rounded, and the part behind the hood's face at L pressed flat onto it
  const cut = (ring, x) =>
    ring.map((q) => (q.u < x ? { u: x, v: q.v, nu: -1, nv: 0, cut: true } : q));
  // the parts of a path with u at or past k, as open runs, each end moved onto u = k
  const keepPast = (pts, k) => {
    const out = [];
    let cur = null;
    pts.forEach((p, i) => {
      const q = pts[i - 1],
        at = (a, b) => {
          const t = (k - a[0]) / (b[0] - a[0]);
          return [k, a[1] + (b[1] - a[1]) * t];
        };
      if (p[0] >= k) {
        if (!cur) out.push((cur = q && q[0] < k ? [at(q, p)] : []));
        cur.push(p);
      } else if (cur) {
        cur.push(at(q, p));
        cur = null;
      }
    });
    return out.filter((r) => r.length > 1);
  };
  // a closed polygon cut to u >= k
  const cutPoly = (pts, k) =>
    pts.flatMap((p, i) => {
      const q = pts[(i + 1) % pts.length],
        x = [k, p[1] + ((q[1] - p[1]) * (k - p[0])) / (q[0] - p[0])];
      return p[0] >= k ? (q[0] >= k ? [p] : [p, x]) : q[0] >= k ? [x] : [];
    });
  // a prism's part with u >= x, filled whole and outlined without the cut face; a filled mark keeps fill and outline apart
  // wall: the cut lies on the hood's solid face, so its outline is drawn outside the opening (y0..y1, z0..z1) and skipped inside it
  const [hy0, hy1, hz0] = [CI - M, BW - CI + M, BZ - M],
    out = (y) => y < hy0 + 0.01 || y > hy1 - 0.01;
  const onWall = (p, q, x) => {
    const [a, b] = p.y < q.y ? [p, q] : [q, p],
      at = (y) => P(x, y, a.z + ((b.z - a.z) * (y - a.y)) / (b.y - a.y));
    return (p.z < hz0 && q.z < hz0) || (a.y === b.y && out(a.y))
      ? seg(p, q)
      : a.y === b.y
        ? ''
        : (a.y < hy0 ? seg(a, at(Math.min(hy0, b.y))) : '') +
          (b.y > hy1 ? seg(at(Math.max(hy1, a.y)), b) : '');
  };
  function cutPrism(pt, ring, inner, z0, z1, x, wall) {
    const sil = hull(
      [z0, z1].flatMap((z) =>
        cut(ring, x).map((q) =>
          Object.assign(P(q.u, q.v, z), { cut: q.cut, y: q.v, z }),
        ),
      ),
    );
    pt.fill.setAttribute('d', poly(sil));
    const crease = inner
      ? keepPast(
          run(inner, front).map((q) => [q.u, q.v]),
          x,
        )
          .map((r) => open(r.map(([u, v]) => P(u, v, z1))))
          .join('')
      : '';
    put(pt.sol, {
      sil: sil
        .map((p, k) => {
          const q = sil[(k + 1) % sil.length];
          return !(p.cut && q.cut) ? seg(p, q) : wall ? onWall(p, q, x) : '';
        })
        .join(''),
      crease,
    });
  }
  [
    [0, -2, BL, BW + 2, 10, 1.5, 0, BZ - 1.5, 0],
    [1, 0.5, BL - 1, BW - 0.5, 9, 1, BZ - 1.5, BZ, 1],
  ].forEach(([x0, y0, x1, y1, r, b, z0, z1, cr]) => {
    const [ring, inner] = rings(x0, y0, x1, y1, r, b);
    cutPrism(part(beltFront), ring, cr ? inner : null, z0, z1, L, true);
  });
  function drawPart(pt, cx, h, x, lit) {
    const [ring, inner] = rings(cx - CW, CI, cx + CW, BW - CI, 3, 1.2);
    cutPrism(pt, ring, inner, BZ, BZ + h, x);
    pt.sol.sil.classList.toggle('hi', lit);
    const side = onSide(cx, BZ + h / 2),
      k = x - cx;
    pt.marks.forEach((m) => {
      m.edge.setAttribute(
        'd',
        keepPast(m.closed ? [...m.pts, m.pts[0]] : m.pts, k)
          .map((r) => open(r.map(side)))
          .join(''),
      );
      if (m.area) {
        const f = cutPoly(m.pts, k);
        m.area.setAttribute('d', f.length > 2 ? poly(f.map(side)) : '');
      }
    });
  }
  let order = '';
  function draw() {
    let d = '';
    for (let x = (phase % 6) + L; x < R; x += 6)
      d += seg(P(x, 1.5, BZ), P(x, BW - 1.5, BZ));
    slats.setAttribute('d', d);
    const near = crates.reduce((a, b) =>
      Math.abs(cxOf(b) - GX) < Math.abs(cxOf(a) - GX) ? b : a,
    );
    // paint the crates far to near: by where they are along the belt
    const sorted = crates.slice().sort((a, b) => cxOf(a) - cxOf(b)),
      key = sorted.map((c) => c.s0).join();
    if (key !== order) {
      sorted.forEach((c) => {
        layer.append(c.grp);
        inside.append(c.back.g);
      });
      order = key;
    }
    crates.forEach((c) => {
      const cx = cxOf(c),
        lit = c === near;
      c.back.g.setAttribute(
        'display',
        cx - CW < L && cx + CW > L - DEEP ? 'inline' : 'none',
      );
      if (cx - CW < L && cx + CW > L - DEEP)
        drawPart(c.back, cx, c.h, L - DEEP, false);
      if (cx + CW < L + 0.5 || cx - CW > H1) {
        c.grp.setAttribute('display', 'none');
        return;
      }
      c.grp.removeAttribute('display');
      drawPart(c.fore, cx, c.h, L, lit);
      // a lid carries the stamp once its centre has passed under the press
      const top = BZ + c.h;
      c.stamp.forEach((el, k) => {
        el.setAttribute('class', cx >= GX && cx < GX + PRESS ? 'nf hi' : 'nf');
        el.setAttribute(
          'd',
          cx >= GX && cx + CW <= H1
            ? poly(STAMP[k][0].map(([u, v]) => P(cx + u, BW / 2 + v, top)))
            : '',
        );
      });
    });
    // the press comes down as the crate nearest it passes under, its head touching the lid at GX; the lamp lights while it presses
    const dx = cxOf(near) - GX,
      p =
        Math.abs(dx) < PRESS ? Math.cos((dx / PRESS) * (Math.PI / 2)) ** 2 : 0;
    const fz = FOOT + (BZ + near.h - FOOT) * p;
    put(
      head,
      prism(
        P,
        front,
        ...rings(GX - 7, YC - 7, GX + 7, YC + 7, 7, 1.2),
        fz,
        fz + 5,
      ),
    );
    // at rest the head sits flush under the cylinder and the rod is hidden inside it
    rod.g.setAttribute('display', CYL - fz - 5 < 0.3 ? 'none' : 'inline');
    put(
      rod,
      prism(
        P,
        front,
        ...rings(GX - 1.6, YC - 1.6, GX + 1.6, YC + 1.6, 1.6, 0.5),
        fz + 5,
        Math.max(CYL, fz + 5.3),
      ),
    );
    // lit, the lamp carries the kind under the press as data-lamp; the host page colours each kind solid
    const on = p > 0.6;
    head.sil.classList.toggle('hi', on);
    lamp.setAttribute('class', on ? 'hi' : 'nf lo');
    lamp.setAttribute('data-lamp', on ? near.kind : '');
    read.textContent = over ? 'belt' : 'rest';
  }

  // the one ambient loop: the belt runs whenever the figure is on screen, at the spring's rate
  const B = register(stage, (dt) => {
    stepS(rate, dt);
    phase += rate.x * SPEED * dt;
    draw();
    return true;
  });
  bag.add(B.unregister);

  bag.add(
    pointer(stage, {
      move: () => {
        over = true;
        rate.t = slow;
        B.wake();
      },
      leave: () => {
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
  'Unit, DOM, browser and Playwright tests ride one belt under one press that stamps rstest on each; hovering slows it.';
// The lamp takes the colour of the kind under the press, and the stamp is green; kept out of the figure, which takes the kernel's classes only.
const TINT =
  "[data-hairline='belt'] path[data-lamp='unit'] { stroke: #22c55e; } [data-hairline='belt'] path[data-lamp='dom'] { stroke: #f59e0b; } [data-hairline='belt'] path[data-lamp='browser'] { stroke: #3b82f6; } [data-hairline='belt'] path[data-lamp='playwright'] { stroke: #ef4444; } [data-hairline='belt'] path.hi[data-lamp='unit'] { fill: #22c55e; } [data-hairline='belt'] path.hi[data-lamp='dom'] { fill: #f59e0b; } [data-hairline='belt'] path.hi[data-lamp='browser'] { fill: #3b82f6; } [data-hairline='belt'] path.hi[data-lamp='playwright'] { fill: #ef4444; } [data-hairline='belt'] path[data-stamp] { stroke: #22c55e; } [data-hairline='belt'] path[data-stamp='tick'] { fill: #22c55e; }";

/** Mounts the figure in `host` the way the package does, with a fixed hovered rate, and plays its tour when asked. Returns the tear-down. */
export function mountBelt(host, { value = 0.2, play = true } = {}) {
  const doc = host.ownerDocument;
  HL.inject(doc);
  if (!doc.getElementById('hairline-belt-tint')) {
    const style = doc.createElement('style');
    style.id = 'hairline-belt-tint';
    style.textContent = TINT;
    doc.head.appendChild(style);
  }
  host.setAttribute('data-hairline', 'belt');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', MEANS);
  const svg = HL.mk(
    'svg',
    { viewBox: '0 0 400 320', 'aria-hidden': 'true' },
    host,
  );
  const figure = mount({ stage: host, svg, read: { textContent: '' } }, value);
  // three stops along the belt, each slowing it under the pointer, then rest
  const lap = play
    ? HL.tour(host, [[158, 145], [200, 166], [242, 187], null])
    : null;
  return () => {
    lap?.stop();
    figure.destroy();
    svg.remove();
    for (const name of ['data-hairline', 'role', 'aria-label'])
      host.removeAttribute(name);
  };
}

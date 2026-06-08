const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'terrain');
const W = 222;
const H = 256;

let seed = 0x9b41d2a7;
function rand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
function rr(a, b) {
  return a + (b - a) * rand();
}
function ri(a, b) {
  return Math.floor(rr(a, b + 1));
}
function pick(items) {
  return items[Math.floor(rand() * items.length)];
}
function uuidForName(name) {
  const hash = crypto.createHash('sha1').update(`sherman-pacific-terrain:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

fs.mkdirSync(outDir, { recursive: true });

const hexPts = [
  [W / 2, H],
  [W, H * 0.75],
  [W, H * 0.25],
  [W / 2, 0],
  [0, H * 0.25],
  [0, H * 0.75],
].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function defs(clipId) {
  return `<defs>
    <clipPath id="${clipId}"><polygon points="${hexPts}"/></clipPath>
    <filter id="soften"><feGaussianBlur stdDeviation="0.55"/></filter>
    <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="11"/><feColorMatrix type="saturate" values="0.14"/><feBlend mode="multiply" in2="SourceGraphic"/></filter>
  </defs>`;
}

function border() {
  return `<polygon points="${hexPts}" fill="none" stroke="#efe4bc" stroke-width="4.2" opacity="0.30"/>
    <polygon points="${hexPts}" fill="none" stroke="#55513d" stroke-width="11" opacity="0.42"/>
    <polygon points="${hexPts}" fill="none" stroke="#313126" stroke-width="4.6" opacity="0.82"/>
    <polygon points="${hexPts}" fill="none" stroke="#171a14" stroke-width="1.6" opacity="0.74"/>`;
}

function ground(svg, palette, opts = {}) {
  for (let i = 0; i < (opts.washes ?? 24); i++) {
    svg += `<ellipse cx="${rr(18, W - 18).toFixed(1)}" cy="${rr(16, H - 16).toFixed(1)}" rx="${rr(22, 70).toFixed(1)}" ry="${rr(12, 42).toFixed(1)}" transform="rotate(${rr(0, 180).toFixed(1)} ${W / 2} ${H / 2})" fill="${pick(palette.wash)}" opacity="${rr(0.10, 0.25).toFixed(2)}" filter="url(#soften)"/>\n`;
  }
  for (let i = 0; i < (opts.grit ?? 220); i++) {
    svg += `<circle cx="${rr(6, W - 6).toFixed(1)}" cy="${rr(6, H - 6).toFixed(1)}" r="${rr(0.45, opts.gritMax ?? 1.75).toFixed(2)}" fill="${pick(palette.grit)}" opacity="${rr(0.16, 0.46).toFixed(2)}"/>\n`;
  }
  for (let i = 0; i < (opts.scratches ?? 36); i++) {
    const x = rr(10, W - 10);
    const y = rr(12, H - 12);
    const a = rr(-35, 30) * Math.PI / 180;
    const len = rr(8, 22);
    svg += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}" stroke="${pick(palette.scratches)}" stroke-width="${rr(0.45, 1.1).toFixed(2)}" opacity="${rr(0.10, 0.28).toFixed(2)}" stroke-linecap="round"/>\n`;
  }
  return svg;
}

function palm(cx, cy, s, rot = 0, opacity = 1) {
  let svg = `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot.toFixed(1)}) scale(${s.toFixed(3)})" opacity="${opacity.toFixed(2)}">`;
  svg += `<ellipse cx="3" cy="6" rx="15" ry="9" fill="#18200f" opacity="0.20"/>`;
  svg += `<path d="M -3 13 C -1 4, 2 -4, 2 -13" fill="none" stroke="#6b5535" stroke-width="4.4" stroke-linecap="round"/>`;
  svg += `<path d="M -3 13 C -1 4, 2 -4, 2 -13" fill="none" stroke="#b08952" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/>`;
  for (let i = 0; i < 7; i++) {
    const a = -150 + i * 45 + rr(-9, 9);
    const len = rr(21, 31);
    const wid = rr(5, 8);
    svg += `<path d="M 2 -15 C ${(Math.cos(a * Math.PI / 180) * len * 0.40).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * len * 0.28 - 15).toFixed(1)}, ${(Math.cos(a * Math.PI / 180) * len).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * len * 0.55 - 15).toFixed(1)}, ${(Math.cos(a * Math.PI / 180) * len * 1.12).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * len * 0.62 - 15).toFixed(1)}" fill="none" stroke="${pick(['#223d1d', '#315726', '#456c34', '#5f7c3b'])}" stroke-width="${wid.toFixed(1)}" stroke-linecap="round"/>`;
    svg += `<path d="M 2 -15 C ${(Math.cos(a * Math.PI / 180) * len * 0.55).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * len * 0.35 - 15).toFixed(1)}, ${(Math.cos(a * Math.PI / 180) * len).toFixed(1)} ${(Math.sin(a * Math.PI / 180) * len * 0.55 - 15).toFixed(1)}" fill="none" stroke="#8aa05a" stroke-width="1.2" opacity="0.45" stroke-linecap="round"/>`;
  }
  svg += `<circle cx="2" cy="-15" r="5" fill="#263918"/></g>`;
  return svg;
}

function rock(x, y, rx, ry, color) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    const d = rr(0.72, 1.14);
    pts.push(`${(x + Math.cos(a) * rx * d).toFixed(1)},${(y + Math.sin(a) * ry * d).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}" opacity="0.95"/>
    <polyline points="${pts.slice(0, 4).join(' ')}" fill="none" stroke="#f0e4c1" stroke-width="1.3" opacity="0.20"/>
    <polyline points="${pts.slice(4).join(' ')}" fill="none" stroke="#171715" stroke-width="1.4" opacity="0.30"/>`;
}

function blobPoints(cx, cy, rx, ry, count, wobble = 0.12) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2;
    const d = rr(1 - wobble, 1 + wobble);
    pts.push(`${(cx + Math.cos(a) * rx * d).toFixed(1)},${(cy + Math.sin(a) * ry * d).toFixed(1)}`);
  }
  return pts;
}

function rockShelf(cx, cy, rx, ry) {
  const edgeRock = [
    [W / 2, H - 2],
    [W - 2, H * 0.75 + 1],
    [W - 2, H * 0.25 - 1],
    [W / 2, 2],
    [2, H * 0.25 - 1],
    [2, H * 0.75 + 1],
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
  const rim = blobPoints(cx, cy, rx * 0.98, ry * 0.90, 24, 0.08);
  const innerShade = blobPoints(cx - rx * 0.01, cy - ry * 0.03, rx * 0.88, ry * 0.77, 22, 0.06);
  const top = blobPoints(cx - rx * 0.07, cy - ry * 0.12, rx * 0.67, ry * 0.54, 20, 0.06);
  const crown = blobPoints(cx - rx * 0.12, cy - ry * 0.19, rx * 0.36, ry * 0.25, 16, 0.07);
  let svg = `<polygon points="${edgeRock.join(' ')}" fill="#565747" opacity="0.98"/>`;
  svg += `<polygon points="${edgeRock.join(' ')}" fill="#292b24" opacity="0.20" filter="url(#soften)"/>`;
  svg += `<polygon points="${rim.join(' ')}" fill="#696756" opacity="0.92"/>`;
  svg += `<polygon points="${innerShade.join(' ')}" fill="#7b7768" opacity="0.98"/>`;
  svg += `<polygon points="${top.join(' ')}" fill="#aaa28b" opacity="0.98"/>`;
  svg += `<polygon points="${crown.join(' ')}" fill="#c3baa0" opacity="0.46"/>`;

  for (let i = 0; i < 22; i++) {
    const a = (Math.PI * 2 * i) / 22 - Math.PI / 2 + rr(-0.07, 0.07);
    const x0 = cx + Math.cos(a) * rx * rr(0.64, 0.74);
    const y0 = cy + Math.sin(a) * ry * rr(0.54, 0.66);
    const x1 = cx + Math.cos(a) * rx * rr(1.02, 1.24);
    const y1 = cy + Math.sin(a) * ry * rr(0.94, 1.14);
    const lit = Math.sin(a) < -0.18 || Math.cos(a) < -0.45;
    svg += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${lit ? '#d6ccb1' : '#34362f'}" stroke-width="${rr(2.0, 4.2).toFixed(1)}" opacity="${lit ? rr(0.25, 0.45).toFixed(2) : rr(0.22, 0.42).toFixed(2)}" stroke-linecap="round"/>`;
  }

  for (let edge = 0; edge < 6; edge++) {
    const a0 = (-30 + 60 * edge) * Math.PI / 180;
    const a1 = (-30 + 60 * (edge + 1)) * Math.PI / 180;
    const x0 = cx + Math.cos(a0) * rx * 1.10;
    const y0 = cy + Math.sin(a0) * ry * 1.02;
    const x1 = cx + Math.cos(a1) * rx * 1.10;
    const y1 = cy + Math.sin(a1) * ry * 1.02;
    svg += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${edge < 3 ? '#3a3b32' : '#8c866f'}" stroke-width="${edge < 3 ? '8.0' : '4.6'}" opacity="${edge < 3 ? '0.22' : '0.18'}" stroke-linecap="round"/>`;
  }

  svg += `<path d="M ${(cx - rx * 0.62).toFixed(1)} ${(cy - ry * 0.34).toFixed(1)}
    C ${(cx - rx * 0.30).toFixed(1)} ${(cy - ry * 0.52).toFixed(1)}, ${(cx + rx * 0.20).toFixed(1)} ${(cy - ry * 0.50).toFixed(1)}, ${(cx + rx * 0.55).toFixed(1)} ${(cy - ry * 0.24).toFixed(1)}"
    fill="none" stroke="#e4dac0" stroke-width="4.2" opacity="0.34" stroke-linecap="round"/>`;
  svg += `<path d="M ${(cx - rx * 0.72).toFixed(1)} ${(cy + ry * 0.30).toFixed(1)}
    C ${(cx - rx * 0.28).toFixed(1)} ${(cy + ry * 0.52).toFixed(1)}, ${(cx + rx * 0.28).toFixed(1)} ${(cy + ry * 0.50).toFixed(1)}, ${(cx + rx * 0.70).toFixed(1)} ${(cy + ry * 0.22).toFixed(1)}"
    fill="none" stroke="#252820" stroke-width="7.4" opacity="0.24" stroke-linecap="round" filter="url(#soften)"/>`;

  for (let i = 0; i < 13; i++) {
    const x = cx + rr(-rx * 0.50, rx * 0.50);
    const y = cy + rr(-ry * 0.32, ry * 0.24);
    const len = rr(8, 23);
    const a = rr(-15, 40) * Math.PI / 180;
    svg += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}" fill="none" stroke="${pick(['#5f5d52', '#d4c9ad', '#3e403a'])}" stroke-width="${rr(1.0, 1.8).toFixed(1)}" opacity="${rr(0.18, 0.34).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return svg;
}

function tile(kind, palette) {
  seed = palette.seed;
  const clipId = `clip_${kind}`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(clipId)}
  <rect width="100%" height="100%" fill="none"/>
  <g clip-path="url(#${clipId})">
    <rect width="${W}" height="${H}" fill="${palette.base}" filter="url(#paper)"/>
`;
  svg = ground(svg, palette, palette.texture);

  if (kind === 'sand') {
    for (let i = 0; i < 18; i++) {
      svg += `<path d="M ${rr(18, W - 18).toFixed(1)} ${rr(18, H - 18).toFixed(1)} q ${rr(-9, 9).toFixed(1)} ${rr(-7, 7).toFixed(1)} ${rr(5, 16).toFixed(1)} ${rr(-5, 9).toFixed(1)}" fill="none" stroke="${pick(['#9e9b62', '#747f45', '#c7b776'])}" stroke-width="${rr(1.0, 2.0).toFixed(1)}" opacity="${rr(0.13, 0.27).toFixed(2)}" stroke-linecap="round"/>\n`;
    }
  }

  if (kind === 'track') {
    for (let i = 0; i < 18; i++) {
      const x = rr(18, W - 18);
      const y = rr(18, H - 18);
      const a = rr(68, 102) * Math.PI / 180;
      const len = rr(18, 52);
      const w = rr(4.0, 8.0);
      svg += `<path d="M ${(x - Math.cos(a) * len * 0.5).toFixed(1)} ${(y - Math.sin(a) * len * 0.5).toFixed(1)} L ${(x + Math.cos(a) * len * 0.5).toFixed(1)} ${(y + Math.sin(a) * len * 0.5).toFixed(1)}" fill="none" stroke="${pick(['#7e6c49', '#8f7a52', '#6f6447'])}" stroke-width="${w.toFixed(1)}" opacity="${rr(0.045, 0.085).toFixed(3)}" stroke-linecap="round"/>\n`;
      if (rand() < 0.50) {
        svg += `<path d="M ${(x - Math.cos(a) * len * 0.35 + rr(-4, 4)).toFixed(1)} ${(y - Math.sin(a) * len * 0.35 + rr(-4, 4)).toFixed(1)} L ${(x + Math.cos(a) * len * 0.35 + rr(-4, 4)).toFixed(1)} ${(y + Math.sin(a) * len * 0.35 + rr(-4, 4)).toFixed(1)}" fill="none" stroke="#ead7a5" stroke-width="${rr(1.0, 2.0).toFixed(1)}" opacity="${rr(0.035, 0.070).toFixed(3)}" stroke-linecap="round"/>\n`;
      }
    }
    for (let i = 0; i < 10; i++) {
      svg += `<ellipse cx="${rr(22, W - 22).toFixed(1)}" cy="${rr(22, H - 22).toFixed(1)}" rx="${rr(11, 30).toFixed(1)}" ry="${rr(3, 9).toFixed(1)}" transform="rotate(${rr(55, 115).toFixed(1)} ${W / 2} ${H / 2})" fill="${pick(['#8b7650', '#e6d3a0', '#a9905f'])}" opacity="${rr(0.035, 0.075).toFixed(3)}" filter="url(#soften)"/>\n`;
    }
  }

  if (kind === 'rocks') {
    svg += rockShelf(W * 0.50, H * 0.50, W * 0.50, H * 0.46);
    for (let i = 0; i < 18; i++) {
      const x = pick([rr(8, 42), rr(W - 42, W - 8), rr(34, W - 34)]);
      const y = pick([rr(16, 64), rr(H - 64, H - 16), rr(52, H - 52)]);
      svg += rock(x, y, rr(5, 12), rr(4, 9), pick(['#514f47', '#666257', '#85806f', '#3f423b']));
    }
  }

  if (kind === 'trees') {
    for (let i = 0; i < 12; i++) {
      svg += palm(rr(24, W - 24), rr(28, H - 28), rr(0.46, 0.66), rr(0, 360), rr(0.88, 1));
    }
    for (let i = 0; i < 14; i++) {
      const x = rr(20, W - 20);
      const y = rr(20, H - 20);
      svg += `<g opacity="${rr(0.80, 0.98).toFixed(2)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr(6, 11).toFixed(1)}" fill="${pick(['#203719', '#315326', '#496737'])}"/><circle cx="${(x - 2).toFixed(1)}" cy="${(y - 2).toFixed(1)}" r="${rr(2, 4).toFixed(1)}" fill="#91a65d" opacity="0.45"/></g>`;
    }
  }

  if (kind === 'water') {
    for (let i = 0; i < 14; i++) {
      const y = rr(18, H - 18);
      svg += `<path d="M ${rr(-25, 20).toFixed(1)} ${y.toFixed(1)} C ${rr(40, 70).toFixed(1)} ${(y + rr(-9, 9)).toFixed(1)}, ${rr(130, 165).toFixed(1)} ${(y + rr(-8, 8)).toFixed(1)}, ${(W + rr(-16, 26)).toFixed(1)} ${(y + rr(-4, 7)).toFixed(1)}" fill="none" stroke="${pick(['#a9d3d6', '#5a98a8', '#d3eee8'])}" stroke-width="${rr(1.1, 2.8).toFixed(1)}" opacity="${rr(0.15, 0.32).toFixed(2)}" stroke-linecap="round"/>\n`;
    }
    svg += `<ellipse cx="50" cy="52" rx="64" ry="28" fill="#cfe9d4" opacity="0.20" filter="url(#soften)"/>`;
  }

  svg += `${border()}
  </g>
</svg>`;
  return svg;
}

function palmSprite(name, seedOffset) {
  seed = (0x9b41d2a7 + seedOffset) >>> 0;
  const w = 96;
  const h = 96;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="none"/>`;
  svg += palm(48, 55, rr(0.78, 0.94), rr(-22, 22), 1);
  if (rand() < 0.55) svg += palm(rr(34, 62), rr(46, 64), rr(0.46, 0.60), rr(0, 360), 0.86);
  for (let i = 0; i < ri(2, 4); i++) {
    const x = rr(30, 68);
    const y = rr(48, 70);
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr(6, 10).toFixed(1)}" fill="${pick(['#213a1a', '#315527', '#4b6635'])}" opacity="${rr(0.80, 0.96).toFixed(2)}"/>`;
  }
  svg += `</svg>`;
  return { svg, w, h };
}

function metaFor(name, width, height, hasAlpha) {
  const uuid = uuidForName(name);
  return {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', '.png'],
    subMetas: {
      '6c48a': {
        importer: 'texture',
        uuid: `${uuid}@6c48a`,
        displayName: name,
        id: '6c48a',
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          imageUuidOrDatabaseUri: uuid,
          isUuid: true,
          visible: false,
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
        },
        ver: '1.0.22',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
      'f9941': {
        importer: 'sprite-frame',
        uuid: `${uuid}@f9941`,
        displayName: name,
        id: 'f9941',
        name: 'spriteFrame',
        userData: {
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
          vertices: {
            rawPosition: [-width / 2, -height / 2, 0, width / 2, -height / 2, 0, -width / 2, height / 2, 0, width / 2, height / 2, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, height, width, height, 0, 0, width, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [-width / 2, -height / 2, 0],
            maxPos: [width / 2, height / 2, 0],
          },
          isUuid: true,
          imageUuidOrDatabaseUri: `${uuid}@6c48a`,
          atlasUuid: '',
          trimType: 'auto',
        },
        ver: '1.0.12',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      type: 'sprite-frame',
      fixAlphaTransparencyArtifacts: false,
      hasAlpha,
      redirect: `${uuid}@6c48a`,
    },
  };
}

async function writePng(name, svg, width, height, hasAlpha = true) {
  const out = path.join(outDir, `${name}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  fs.writeFileSync(`${out}.meta`, `${JSON.stringify(metaFor(name, width, height, hasAlpha), null, 2)}\n`);
  console.log(out);
}

async function main() {
  const sand = {
    base: '#d5c58e',
    wash: ['#eadbad', '#bca970', '#cfc080', '#a7a163'],
    grit: ['#f2e5bd', '#8d815b', '#b8aa74', '#6f704e'],
    scratches: ['#827856', '#e8d8a6', '#9b945f'],
    texture: { washes: 28, grit: 245, gritMax: 1.65, scratches: 46 },
  };
  const tiles = {
    pacific_sand: { ...sand, seed: 0x9b410001 },
    pacific_track: {
      base: '#cdb782',
      wash: ['#ead7a5', '#a98e5d', '#d5bf88', '#8c805b'],
      grit: ['#f0dfad', '#796944', '#b69a68'],
      scratches: ['#6f5c3d', '#e7d5a0', '#9f8559'],
      texture: { washes: 24, grit: 210, gritMax: 1.75, scratches: 52 },
      seed: 0x9b410002,
    },
    pacific_rocks: {
      base: '#b8aa80',
      wash: ['#d8ca9b', '#807961', '#aaa07b', '#706c5c'],
      grit: ['#eee1b2', '#625f54', '#958a6a', '#4b4d47'],
      scratches: ['#72694f', '#d5c59a', '#57584e'],
      texture: { washes: 18, grit: 130, gritMax: 1.55, scratches: 22 },
      seed: 0x9b410003,
    },
    pacific_trees: {
      ...sand,
      base: '#cabc86',
      wash: ['#e4d7a9', '#a7a064', '#c2b56f', '#8d985d'],
      grit: ['#efe2b6', '#73734f', '#a89b63', '#536235'],
      scratches: ['#776f4f', '#d9ca98', '#77884c'],
      texture: { washes: 22, grit: 180, gritMax: 1.4, scratches: 28 },
      seed: 0x9b410004,
    },
    pacific_water: {
      base: '#5ea8b5',
      wash: ['#7cc5c9', '#327485', '#9fd6d1', '#3e91a4'],
      grit: ['#bde4dd', '#367887', '#68afba'],
      scratches: ['#bfe6e0', '#448c9a', '#6fb8c1'],
      texture: { washes: 20, grit: 80, gritMax: 1.0, scratches: 10 },
      seed: 0x9b410005,
    },
  };

  for (const [name, palette] of Object.entries(tiles)) {
    await writePng(name, tile(name.replace('pacific_', ''), palette), W, H, true);
  }

  for (const [name, seedOffset] of [
    ['pacific_tree_01', 0x101],
    ['pacific_tree_02', 0x202],
    ['pacific_tree_03', 0x303],
    ['pacific_tree_04', 0x404],
  ]) {
    const tree = palmSprite(name, seedOffset);
    await writePng(name, tree.svg, tree.w, tree.h, true);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const outDir = path.join(__dirname, '..', 'assets', 'resources', 'textures', 'terrain');
const W = 222;
const H = 256;

let seed = 0x51f0a7d3;
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
  const hash = crypto.createHash('sha1').update(`sherman-terrain:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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

function addTileTexture(kind, palette) {
  const clipId = `clip_${kind}`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="${clipId}"><polygon points="${hexPts}"/></clipPath>
    <filter id="soften"><feGaussianBlur stdDeviation="0.45"/></filter>
  </defs>
  <rect width="100%" height="100%" fill="none"/>
  <g clip-path="url(#${clipId})">
    <rect width="${W}" height="${H}" fill="${palette.base}"/>
`;

  for (let i = 0; i < palette.washes; i++) {
    const col = pick(palette.wash);
    svg += `<ellipse cx="${rr(20, W - 20).toFixed(1)}" cy="${rr(18, H - 18).toFixed(1)}" rx="${rr(24, 66).toFixed(1)}" ry="${rr(12, 36).toFixed(1)}" transform="rotate(${rr(0, 180).toFixed(1)} ${W / 2} ${H / 2})" fill="${col}" opacity="${rr(0.10, 0.24).toFixed(2)}" filter="url(#soften)"/>\n`;
  }

  for (let i = 0; i < palette.grit; i++) {
    const col = pick(palette.gritColors);
    svg += `<circle cx="${rr(8, W - 8).toFixed(1)}" cy="${rr(8, H - 8).toFixed(1)}" r="${rr(0.7, palette.gritMax).toFixed(1)}" fill="${col}" opacity="${rr(0.18, 0.48).toFixed(2)}"/>\n`;
  }

  if (kind === 'field') {
    for (let i = 0; i < 115; i++) {
      const x = rr(12, W - 12);
      const y = rr(12, H - 12);
      const len = rr(3.5, 9.0);
      const a = rr(-35, 35) * Math.PI / 180;
      svg += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${(Math.cos(a) * len).toFixed(1)} ${(Math.sin(a) * len).toFixed(1)}" stroke="${pick(['#73964d', '#8faf62', '#5f7f3d'])}" stroke-width="${rr(0.45, 0.9).toFixed(2)}" opacity="${rr(0.22, 0.50).toFixed(2)}" stroke-linecap="round"/>\n`;
    }
  }

  if (kind === 'mud') {
    for (let i = 0; i < 14; i++) {
      svg += `<ellipse cx="${rr(22, W - 22).toFixed(1)}" cy="${rr(18, H - 18).toFixed(1)}" rx="${rr(13, 30).toFixed(1)}" ry="${rr(4, 12).toFixed(1)}" transform="rotate(${rr(0, 180).toFixed(1)} ${W / 2} ${H / 2})" fill="${pick(['#c2b49d', '#756b5f', '#958879'])}" opacity="${rr(0.12, 0.28).toFixed(2)}" filter="url(#soften)"/>\n`;
    }
  }

  if (kind === 'water') {
    for (let i = 0; i < 12; i++) {
      const y = rr(26, H - 26);
      svg += `<path d="M ${rr(-20, 20).toFixed(1)} ${y.toFixed(1)} C ${rr(55, 85).toFixed(1)} ${(y + rr(-10, 10)).toFixed(1)}, ${rr(140, 180).toFixed(1)} ${(y + rr(-10, 10)).toFixed(1)}, ${(W + rr(-20, 20)).toFixed(1)} ${(y + rr(-6, 6)).toFixed(1)}" fill="none" stroke="${pick(['#6f8aa0', '#9cafb8', '#536d83'])}" stroke-width="${rr(1.0, 2.0).toFixed(1)}" opacity="${rr(0.12, 0.24).toFixed(2)}" stroke-linecap="round"/>\n`;
    }
  }

  if (kind === 'forest') {
    for (let i = 0; i < 58; i++) {
      const x = rr(22, W - 22);
      const y = rr(20, H - 20);
      const r = rr(4.5, 9.0);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${pick(['#24451f', '#315a28', '#426b32', '#182f17'])}" opacity="${rr(0.35, 0.72).toFixed(2)}"/>\n`;
      if (rand() < 0.35) svg += `<circle cx="${(x - r * 0.25).toFixed(1)}" cy="${(y + r * 0.25).toFixed(1)}" r="${(r * 0.35).toFixed(1)}" fill="#6f8e48" opacity="0.45"/>\n`;
    }
  }

  svg += `    <polygon points="${hexPts}" fill="none" stroke="#f0e9ca" stroke-width="3.0" opacity="0.20"/>
    <polygon points="${hexPts}" fill="none" stroke="#111812" stroke-width="16" opacity="0.22"/>
    <polygon points="${hexPts}" fill="none" stroke="#2b3028" stroke-width="7" opacity="0.72"/>
    <polygon points="${hexPts}" fill="none" stroke="#080b08" stroke-width="2.2" opacity="0.58"/>
  </g>
</svg>`;
  return svg;
}

function addHedgeTexture() {
  const w = 256;
  const h = 82;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="none"/>
  <g opacity="0.56">
`;
  for (let i = 0; i < 36; i++) {
    svg += `<ellipse cx="${rr(8, w - 8).toFixed(1)}" cy="${rr(34, 55).toFixed(1)}" rx="${rr(7, 17).toFixed(1)}" ry="${rr(4, 9).toFixed(1)}" fill="#070b06" opacity="${rr(0.18, 0.34).toFixed(2)}"/>\n`;
  }
  svg += `</g>\n`;
  for (let i = 0; i < 34; i++) {
    const x = 9 + i * ((w - 18) / 33) + rr(-4.2, 4.2);
    const y = 42 + Math.sin(i * 0.65) * 6 + rr(-5.5, 5.5);
    const base = rr(8.5, 15.5);
    svg += `<g>\n`;
    for (let j = 0; j < ri(5, 8); j++) {
      const a = rr(0, Math.PI * 2);
      const d = rr(0, base * 0.58);
      const cx = x + Math.cos(a) * d;
      const cy = y + Math.sin(a) * d;
      svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(base * rr(0.36, 0.66)).toFixed(1)}" fill="${pick(['#132514', '#1f3d1d', '#304f28', '#425f31'])}" opacity="${rr(0.92, 1).toFixed(2)}"/>\n`;
    }
    svg += `<circle cx="${(x - base * 0.18).toFixed(1)}" cy="${(y + base * 0.10).toFixed(1)}" r="${(base * rr(0.14, 0.22)).toFixed(1)}" fill="#7f9d55" opacity="${rr(0.42, 0.75).toFixed(2)}"/>\n`;
    svg += `</g>\n`;
  }
  for (let i = 0; i < 28; i++) {
    svg += `<path d="M ${rr(7, w - 7).toFixed(1)} ${rr(28, 58).toFixed(1)} l ${rr(-4, 4).toFixed(1)} ${rr(-3, 4).toFixed(1)}" stroke="#9bb36c" stroke-width="${rr(0.7, 1.2).toFixed(1)}" opacity="${rr(0.35, 0.62).toFixed(2)}" stroke-linecap="round"/>\n`;
  }
  svg += `</svg>`;
  return { svg, w, h };
}

function addTreeTexture(name, colors, seedOffset) {
  seed = (0x51f0a7d3 + seedOffset) >>> 0;
  const w = 96;
  const h = 96;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="none"/>
  <ellipse cx="42" cy="37" rx="${rr(22, 28).toFixed(1)}" ry="${rr(13, 18).toFixed(1)}" fill="#071006" opacity="${rr(0.26, 0.38).toFixed(2)}"/>
`;
  const blobs = ri(12, 17);
  for (let i = 0; i < blobs; i++) {
    const a = rr(0, Math.PI * 2);
    const d = rr(0, 20);
    const cx = 48 + Math.cos(a) * d + rr(-2.5, 2.5);
    const cy = 49 + Math.sin(a) * d * 0.9 + rr(-2.5, 2.5);
    const r = rr(10, 17);
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pick(colors.dark)}" opacity="${rr(0.92, 1).toFixed(2)}"/>\n`;
  }
  for (let i = 0; i < ri(5, 8); i++) {
    const a = rr(-Math.PI * 0.95, Math.PI * 0.25);
    const d = rr(4, 20);
    svg += `<circle cx="${(48 + Math.cos(a) * d).toFixed(1)}" cy="${(49 + Math.sin(a) * d).toFixed(1)}" r="${rr(4.0, 7.5).toFixed(1)}" fill="${pick(colors.light)}" opacity="${rr(0.55, 0.82).toFixed(2)}"/>\n`;
  }
  for (let i = 0; i < ri(12, 18); i++) {
    const a = rr(0, Math.PI * 2);
    const d = rr(2, 24);
    svg += `<circle cx="${(48 + Math.cos(a) * d).toFixed(1)}" cy="${(49 + Math.sin(a) * d).toFixed(1)}" r="${rr(1.1, 2.2).toFixed(1)}" fill="${pick(colors.spark)}" opacity="${rr(0.28, 0.55).toFixed(2)}"/>\n`;
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
  const tiles = {
    terrain_field: {
      base: '#c2d98a',
      wash: ['#d7e7a5', '#9fbd68', '#b7cc80'],
      gritColors: ['#6f8f45', '#e1edb1', '#91ab5c'],
      washes: 22,
      grit: 210,
      gritMax: 1.65,
    },
    terrain_mud: {
      base: '#908577',
      wash: ['#6f675f', '#b4a896', '#82796d'],
      gritColors: ['#5e574f', '#bfb29c', '#756d64'],
      washes: 24,
      grit: 135,
      gritMax: 2.5,
    },
    terrain_road: {
      base: '#d2bf98',
      wash: ['#e4d3ad', '#bfa77c', '#cbb58d'],
      gritColors: ['#f0dfb7', '#9f835e', '#baa47e'],
      washes: 18,
      grit: 155,
      gritMax: 2.15,
    },
    terrain_forest: {
      base: '#6f8f4d',
      wash: ['#506f3e', '#8faa5f', '#3f5d34'],
      gritColors: ['#315127', '#a6ba75', '#536f3c'],
      washes: 16,
      grit: 100,
      gritMax: 1.8,
    },
    terrain_water: {
      base: '#607989',
      wash: ['#7892a0', '#415d70', '#8297a2'],
      gritColors: ['#91a6ae', '#40596c', '#6f8796'],
      washes: 18,
      grit: 70,
      gritMax: 1.2,
    },
  };

  for (const [name, palette] of Object.entries(tiles)) {
    await writePng(name, addTileTexture(name.replace('terrain_', ''), palette), W, H, true);
  }

  const hedge = addHedgeTexture();
  await writePng('hedge_edge', hedge.svg, hedge.w, hedge.h, true);

  const trees = [
    ['tree_01', { dark: ['#152813', '#213c1d', '#2e4c27'], light: ['#5f8041', '#769852'], spark: ['#94aa67', '#6f8d50'] }, 0x1001],
    ['tree_02', { dark: ['#1a2f16', '#27451f', '#38562b'], light: ['#6b8b45', '#819c58'], spark: ['#a0b46d', '#7e9854'] }, 0x1002],
    ['tree_03', { dark: ['#122511', '#1d361a', '#2b4723'], light: ['#58783c', '#708f4d'], spark: ['#8fa862', '#6d894b'] }, 0x1003],
    ['tree_04', { dark: ['#20341d', '#30472a', '#43593a'], light: ['#788a62', '#8c9d72'], spark: ['#aab889', '#879b6d'] }, 0x1004],
  ];
  for (const [name, colors, seedOffset] of trees) {
    const tree = addTreeTexture(name, colors, seedOffset);
    await writePng(name, tree.svg, tree.w, tree.h, true);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

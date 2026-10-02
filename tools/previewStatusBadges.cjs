const sharp = require('sharp');
const path = require('path');

const output = path.resolve(__dirname, '../source_art/ui/status_badges_preview.png');

function badge(kind) {
  const symbol = kind === 'paralyzed' ? `
    <path d="M3.74 15.4H18.26 M3.74 6.6H9.35 M12.98 5.61H18.26 M5.5 15.18V6.82 M16.5 15.18V5.72"
      stroke="#432059" stroke-width="4" fill="none"/>
    <path d="M3.74 15.4H18.26 M3.74 6.6H9.35 M12.98 5.61H18.26 M5.5 15.18V6.82 M16.5 15.18V5.72"
      stroke="#f1d4ff" stroke-width="2.25" fill="none"/>
    <path d="M10.56 4.4L12.21 8.36" stroke="#432059" stroke-width="3.5" fill="none"/>
    <path d="M10.56 4.4L12.21 8.36" stroke="#fff1b8" stroke-width="1.8" fill="none"/>`
    : kind === 'turret' ? `
    <circle cx="9.57" cy="11" r="4.73" stroke="#5e2c12" stroke-width="4" fill="none"/>
    <path d="M14.19 11H19.36" stroke="#5e2c12" stroke-width="4" fill="none"/>
    <circle cx="9.57" cy="11" r="4.73" stroke="#ffd57d" stroke-width="2.2" fill="none"/>
    <path d="M14.19 11H19.36" stroke="#ffd57d" stroke-width="2.2" fill="none"/>
    <path d="M8.25 6.93L10.34 10.12L9.02 11.77L11.22 14.96"
      stroke="#5e2c12" stroke-width="3.5" fill="none"/>
    <path d="M8.25 6.93L10.34 10.12L9.02 11.77L11.22 14.96"
      stroke="#fff6c7" stroke-width="1.8" fill="none"/>`
    : `
    <circle cx="11" cy="11" r="3.75" stroke="#4e3913" stroke-width="4" fill="none"/>
    <path d="M2.42 11H6.28 M15.72 11H19.58 M11 2.42V6.28 M11 15.72V19.58"
      stroke="#4e3913" stroke-width="4" fill="none"/>
    <circle cx="11" cy="11" r="3.75" stroke="#ffdc76" stroke-width="2.15" fill="none"/>
    <path d="M2.42 11H6.28 M15.72 11H19.58 M11 2.42V6.28 M11 15.72V19.58"
      stroke="#ffdc76" stroke-width="2.15" fill="none"/>
    <circle cx="11" cy="11" r="1.43" fill="#fff5c2"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    ${symbol}
  </svg>`);
}

async function main() {
  const w = 773, h = 252;
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#8ba76f"/>
    <rect x="14" y="14" width="239" height="224" rx="10" fill="#b9cf94" stroke="#78935f"/>
    <rect x="267" y="14" width="239" height="224" rx="10" fill="#b9cf94" stroke="#78935f"/>
    <rect x="520" y="14" width="239" height="224" rx="10" fill="#b9cf94" stroke="#78935f"/>
    <g fill="#283526" font-family="Microsoft YaHei, sans-serif" font-size="21" font-weight="bold">
      <text x="28" y="45">瘫痪 · 断裂履带</text><text x="281" y="45">炮塔受损 · 裂纹</text><text x="534" y="45">伏击 · 准星</text>
    </g>
    <g fill="#405337" font-family="Microsoft YaHei, sans-serif" font-size="14">
      <text x="29" y="224">左：放大 6 倍　右：实际尺寸</text>
      <text x="282" y="224">左：放大 6 倍　右：实际尺寸</text>
      <text x="535" y="224">左：放大 6 倍　右：实际尺寸</text>
    </g>
  </svg>`);
  const layers = [];
  for (const [kind, x] of [['paralyzed', 29], ['turret', 282], ['ambush', 535]]) {
    const small = await sharp(badge(kind)).png().toBuffer();
    const large = await sharp(small).resize(132, 132, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: large, left: x, top: 62 });
    layers.push({ input: small, left: x + 165, top: 122 });
  }
  await sharp(backdrop).composite(layers).png().toFile(output);
  console.log(output);
}

main().catch(error => { console.error(error); process.exitCode = 1; });

const sharp = require('sharp');

const input = process.argv[2];
const output = process.argv[3];

(async () => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const kr = data[0], kg = data[1], kb = data[2];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const distance = Math.hypot(r - kr, g - kg, b - kb);
    const magentaScore = Math.min(r, b) - g;
    let alpha = Math.round(255 * Math.max(0, Math.min(1, (distance - 18) / 70)));
    // Generated chroma backgrounds can have slight gradients. Treat strongly
    // magenta pixels as key color even when their RGB differs from the corner.
    if (Math.min(r, b) > 140 && magentaScore > 70) alpha = 0;
    else if (Math.min(r, b) > 110 && magentaScore > 45) {
      alpha = Math.min(alpha, Math.round(255 * (70 - magentaScore) / 25));
    }
    data[i + 3] = alpha;
  }
  await sharp(data, { raw: info }).png().toFile(output);
  const alpha = await sharp(output).extractChannel('alpha').raw().toBuffer();
  let min = 255, max = 0, nonzero = 0;
  for (const v of alpha) { min = Math.min(min, v); max = Math.max(max, v); if (v) nonzero++; }
  console.log(JSON.stringify({ width: info.width, height: info.height, alpha: [min, max], coverage: nonzero / alpha.length }));
})().catch(err => { console.error(err); process.exit(1); });

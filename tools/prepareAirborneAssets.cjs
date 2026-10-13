const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
for (const [source, destination, width, height] of [
  ['source_art/aircraft/c47/c47_top_300.png', 'assets/resources/textures/units/c47_top.png', 300, 206],
  ['source_art/effects/parachute/ww2_parachute_top_150.png', 'assets/resources/textures/effects/parachute_top.png', 150, 141],
]) {
  const target = path.join(root, destination);
  fs.copyFileSync(path.join(root, source), target);
  const meta = JSON.parse(fs.readFileSync(fs.existsSync(`${target}.meta`) ? `${target}.meta` : path.join(root, 'assets/resources/textures/units/stuka_top.png.meta'), 'utf8'));
  const uuid = fs.existsSync(`${target}.meta`) ? meta.uuid : crypto.randomUUID();
  meta.uuid = uuid;
  meta.userData = { ...(meta.userData ?? {}), redirect: `${uuid}@6c48a` };
  const name = path.basename(target, '.png');
  for (const [id, sub] of Object.entries(meta.subMetas)) {
    sub.uuid = `${uuid}@${id}`;
    sub.displayName = name;
    if (id === '6c48a') sub.userData.imageUuidOrDatabaseUri = uuid;
    if (id === 'f9941') {
      Object.assign(sub.userData, { trimThreshold: 1, trimX: 0, trimY: 0, width, height, rawWidth: width, rawHeight: height, offsetX: 0, offsetY: 0, textureUuid: `${uuid}@6c48a` });
      sub.userData.imageUuidOrDatabaseUri = `${uuid}@6c48a`;
      delete sub.userData.vertices;
    }
  }
  fs.writeFileSync(`${target}.meta`, JSON.stringify(meta, null, 2));
}
for (const name of ['RoundEvents', 'AirborneSupport']) {
  const file = path.join(root, `assets/scripts/core/${name}.ts.meta`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ ver: '4.0.24', importer: 'typescript', imported: true, uuid: crypto.randomUUID(), files: [], subMetas: {}, userData: {} }, null, 2));
}

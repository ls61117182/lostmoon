"""Install the confirmed Maus layers, preserving a shared hull/wreck transform."""
from pathlib import Path
from datetime import datetime, timezone
import csv
import io
import json
import shutil
from PIL import Image

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
UNITS = ROOT / 'assets/resources/textures/units'
CSV = ROOT / 'data/tank_visuals.csv'
DB = ROOT / 'assets/scripts/core/TankVisualDB.ts'
BACKUP = ROOT / 'asset_backups/latest/maus' / (datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '_before_confirmed_redraw')
BACKUP.mkdir(parents=True, exist_ok=False)

protected = [CSV, DB, ROOT / 'source_art/tanks/german-late-war/asset-report.json']
for folder in [UNITS, UNITS / 'late_war']:
    for suffix in ['', '_hull', '_turret', '_destroyed']:
        png = folder / ('maus_top' + suffix + '.png')
        protected.extend([png, Path(str(png) + '.meta')])
for path in protected:
    destination = BACKUP / path.relative_to(ROOT)
    if destination.suffix == '.ts':
        destination = destination.with_name(destination.name + '.bak')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)

# Orthogonal rotation only: front-up review art -> front-left runtime assets.
def rotated(name):
    return Image.open(SOURCE / name).convert('RGBA').transpose(Image.Transpose.ROTATE_90)

hull_raw = rotated('maus_top_hull_candidate.png')
wreck_raw = rotated('maus_top_destroyed_candidate.png')
turret_raw = rotated('maus_top_turret_candidate.png')
# Hull and wreck use their UNION bounds, so exposed damaged tracks are retained.
# No independent resize, tight crop or fit-to-canvas can move the fuel drum.
def solid_box(im):
    return im.getchannel('A').point(lambda v: 255 if v >= 16 else 0).getbbox()

hb, wb = solid_box(hull_raw), solid_box(wreck_raw)
hull_box = (min(hb[0], wb[0]), min(hb[1], wb[1]), max(hb[2], wb[2]), max(hb[3], wb[3]))
turret_box = solid_box(turret_raw)
hull = hull_raw.crop(hull_box)
wreck = wreck_raw.crop(hull_box)
turret = turret_raw.crop(turret_box)

# Points in the rotated 300 x 112 common review canvas.
common_pivot = (163, 55)
common_muzzle = (6, 56)
common_hatch = (195, 68)
def local(point, box):
    return (point[0] - box[0], point[1] - box[1])
hull_pivot = local(common_pivot, hull_box)
turret_pivot = local(common_pivot, turret_box)
muzzle = local(common_muzzle, turret_box)
hatch = local(common_hatch, turret_box)
turret_xy = (hull_pivot[0] - turret_pivot[0], hull_pivot[1] - turret_pivot[1])
margin_x = max(0, -turret_xy[0], turret_xy[0] + turret.width - hull.width)
margin_y = max(0, -turret_xy[1], turret_xy[1] + turret.height - hull.height)
top = Image.new('RGBA', (hull.width + 2 * margin_x, hull.height + 2 * margin_y))
top.alpha_composite(hull, (margin_x, margin_y))
top.alpha_composite(turret, (margin_x + turret_xy[0], margin_y + turret_xy[1]))

def sync_meta(png, width, height):
    path = Path(str(png) + '.meta')
    meta = json.loads(path.read_text(encoding='utf-8'))
    frame = next(sub for sub in meta['subMetas'].values() if sub['importer'] == 'sprite-frame')['userData']
    frame.update(width=width, height=height, rawWidth=width, rawHeight=height,
                 trimX=0, trimY=0, offsetX=0, offsetY=0, trimType='none')
    hw, hh = width / 2, height / 2
    frame['vertices'] = {
        'rawPosition': [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
        'indexes': [0, 1, 2, 2, 1, 3],
        'uv': [0, height, width, height, 0, 0, width, 0],
        'nuv': [0, 0, 1, 0, 0, 1, 1, 1],
        'minPos': [-hw, -hh, 0], 'maxPos': [hw, hh, 0],
    }
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

for suffix, image in [('', top), ('_hull', hull), ('_turret', turret), ('_destroyed', wreck)]:
    assert max(image.size) <= 300
    target = UNITS / ('maus_top' + suffix + '.png')
    image.save(target)
    sync_meta(target, *image.size)

text = CSV.read_text(encoding='utf-8-sig')
lines = text.splitlines()
headers = next(csv.reader([lines[0]]))
updates = {
    'topTrimX': 0, 'topTrimY': 0, 'topTrimW': hull.width, 'topTrimH': hull.height,
    'turretTrimX': 0, 'turretTrimY': 0, 'turretTrimW': turret.width, 'turretTrimH': turret.height,
    'turretPivotX': hull_pivot[0], 'turretPivotY': hull_pivot[1],
    'turretSpritePivotX': turret_pivot[0], 'turretSpritePivotY': turret_pivot[1],
    'muzzleSpriteX': muzzle[0], 'muzzleSpriteY': muzzle[1],
    'commanderHatchSpriteX': hatch[0], 'commanderHatchSpriteY': hatch[1],
    'commanderHatchScale': 16, 'turretScale': 1,
    'turretOffsetForward': 0, 'turretOffsetRight': 0,
    'destroyedFitScale': 1, 'destroyedOffsetForward': 0, 'destroyedOffsetRight': 0,
    'notes': 'Confirmed 2026-10-19 ImageGen redraw revision-03; centered main gun; half-overlapping shared rear fuel drum; hull-only wreck; front-left runtime rotation; identical hull/wreck crop',
}
for i, line in enumerate(lines):
    if not line.startswith('maus,'):
        continue
    row = next(csv.reader([line]))
    for field, value in updates.items():
        row[headers.index(field)] = str(value)
    buffer = io.StringIO(newline='')
    csv.writer(buffer, lineterminator='').writerow(row)
    lines[i] = buffer.getvalue()
    break
else:
    raise RuntimeError('Maus CSV record not found')
CSV.write_bytes(b'\xef\xbb\xbf' + ('\n'.join(lines) + '\n').encode('utf-8'))

# Confirm the same crop preserves the exposed fuel pixels in both states.
assert hull.size == wreck.size
for point, image in [(hull_pivot, hull), (turret_pivot, turret), (muzzle, turret), (hatch, turret)]:
    assert 0 <= point[0] < image.width and 0 <= point[1] < image.height
report = {
    'installed': True, 'source_revision': 3, 'front': 'left',
    'backup': str(BACKUP.relative_to(ROOT)),
    'hull_and_destroyed_common_crop': hull_box, 'turret_crop': turret_box,
    'hull_size': hull.size, 'turret_size': turret.size, 'top_size': top.size,
    'hull_pivot': hull_pivot, 'turret_pivot': turret_pivot, 'muzzle': muzzle, 'hatch': hatch,
    'hull_offset_in_top': [margin_x, margin_y],
    'notes': 'Runtime orientation/cropping only. No color changes or image generation during installation.',
}
(SOURCE / 'game-integration.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))

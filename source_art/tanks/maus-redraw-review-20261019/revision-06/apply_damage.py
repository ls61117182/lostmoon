"""Install stronger local wreck damage over the exact accepted intact hull."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
UNITS = ROOT / 'assets/resources/textures/units'

def rgba(path):
    return Image.open(path).convert('RGBA')

protected_names = ['maus_top.png', 'maus_top_hull.png', 'maus_top_turret.png']
original_hashes = {name: hashlib.sha256((UNITS / name).read_bytes()).hexdigest()
                   for name in protected_names}
hull = rgba(UNITS / 'maus_top_hull.png')
previous = rgba(SOURCE / 'before-maus_top_destroyed.png')
assert hull.size == previous.size == (258, 99)
assert hull.tobytes() == rgba(SOURCE / 'before-maus_top_hull.png').tobytes()

# Always begin with the intact hull; never use a separately generated whole wreck.
wreck = hull.copy()
damage_mask = Image.new('L', hull.size, 0)
specs = [
    {'name': 'ring', 'box': (114, 7, 198, 91), 'ellipse': (119, 11, 192, 87)},
    {'name': 'grille', 'box': (54, 60, 117, 97), 'ellipse': (60, 64, 115, 95)},
    {'name': 'rear-panel', 'box': (178, 44, 227, 88), 'ellipse': (181, 47, 225, 85)},
    {'name': 'skirt', 'box': (113, 0, 151, 22), 'ellipse': (119, 3, 146, 18)},
]
for spec in specs:
    box = spec['box']
    mask = Image.new('L', hull.size, 0)
    ImageDraw.Draw(mask).ellipse(spec['ellipse'], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.65)).point(lambda v: 0 if v < 8 else v)
    spec['mask_bounds'] = mask.getbbox()
    patch = rgba(SOURCE / (spec['name'] + '-damage-generated.png'))
    patch = patch.resize((box[2]-box[0], box[3]-box[1]), Image.Resampling.LANCZOS)
    canvas = hull.copy()
    canvas.paste(patch, box[:2])
    wreck = Image.composite(canvas, wreck, mask)
    damage_mask = ImageChops.lighter(damage_mask, mask)
wreck.putalpha(hull.getchannel('A'))

mask_values = list(damage_mask.get_flattened_data())
hull_pixels = list(hull.get_flattened_data())
wreck_pixels = list(wreck.get_flattened_data())
changed = sum(a != b for a, b in zip(hull_pixels, wreck_pixels))
allowed = sum(bool(v) for v in mask_values)
assert 100 < allowed < len(mask_values) * 0.32
for a, b, mask in zip(hull_pixels, wreck_pixels, mask_values):
    if not mask:
        assert a == b, 'An intact detail outside the damage mask changed'
assert wreck.getchannel('A').tobytes() == hull.getchannel('A').tobytes()
assert wreck.crop((228, 20, 258, 80)).tobytes() == hull.crop((228, 20, 258, 80)).tobytes()

stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
backup = ROOT / 'asset_backups/latest/maus' / (stamp + '_before_stronger_damage')
backup.mkdir(parents=True, exist_ok=False)
paths = [ROOT / 'data/tank_art/maus_damage_mask.png',
         ROOT / 'source_art/tanks/german-late-war/asset-report.json']
for folder in [UNITS, UNITS / 'late_war']:
    for suffix in ['', '_hull', '_turret', '_destroyed']:
        path = folder / ('maus_top' + suffix + '.png')
        paths.extend([path, Path(str(path) + '.meta')])
for path in paths:
    destination = backup / path.relative_to(ROOT)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)

wreck.save(UNITS / 'maus_top_destroyed.png')
wreck.save(SOURCE / 'maus_top_destroyed-installed.png')
damage_mask.save(ROOT / 'data/tank_art/maus_damage_mask.png')
damage_mask.save(SOURCE / 'damage-mask.png')
for name, sha in original_hashes.items():
    assert hashlib.sha256((UNITS / name).read_bytes()).hexdigest() == sha

def dark_count(im):
    return sum(p[3] > 220 and sum(p[:3]) / 3 < 65 for p in im.get_flattened_data())

report = {
    'revision': 6, 'status': 'installed_for_in_game_review',
    'wreck_base': 'exact accepted intact maus_top_hull.png',
    'unchanged_normal_file_sha256': original_hashes,
    'damage_regions': specs,
    'changed_pixels': changed, 'damage_mask_pixels': allowed,
    'unchanged_pixels_outside_damage_mask': len(mask_values) - allowed,
    'outside_damage_pixels_exactly_equal': True,
    'alpha_silhouette_identical': True, 'fuel_pixels_exactly_equal': True,
    'opaque_dark_pixels_before': dark_count(previous),
    'opaque_dark_pixels_after': dark_count(wreck),
    'runtime_geometry': 'unchanged; 258x99 hull and wreck; hull pivot (155,49)',
    'backup': str(backup.relative_to(ROOT)),
}
(SOURCE / 'game-integration.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))

font = 'C:/Windows/Fonts/msyh.ttc'
title = ImageFont.truetype(font, 23)
label = ImageFont.truetype(font, 18)
small = ImageFont.truetype(font, 15)
board = Image.new('RGB', (870, 800), '#e4e5df')
d = ImageDraw.Draw(board)
d.text((20, 12), '鼠式毁伤加强：车身底图与未受损细节保持一致', font=title, fill='#252d29')
d.text((20, 48), '左：258×99 原始像素尺寸     右：2 倍放大检查', font=small, fill='#40483f')
for row, (im, text) in enumerate([(hull, '正常车身'), (previous, '修改前击毁图'), (wreck, '加强后击毁图')]):
    y = 88 + row * 234
    d.text((20, y), text, font=label, fill='#252d29')
    for x, scale in [(20, 1), (326, 2)]:
        resized = im.resize((im.width*scale, im.height*scale), Image.Resampling.NEAREST)
        pane = Image.new('RGBA', resized.size, '#59644d')
        pane.alpha_composite(resized)
        board.paste(pane.convert('RGB'), (x, y+30))
board.save(SOURCE / 'damage-comparison.png')

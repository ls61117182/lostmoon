from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent

def load_image(name):
    im = Image.open(ROOT / name).convert('RGBA')
    im.putalpha(im.getchannel('A').point(lambda v: 0 if v < 10 else v))
    return im

def solid_bounds(im):
    return im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()

def row_center(im, y):
    values = im.getchannel('A').crop((0, y, im.width, y + 1)).get_flattened_data()
    xs = [x for x, alpha in enumerate(values) if alpha > 128]
    return (min(xs) + max(xs)) / 2

hull_raw = load_image('hull-with-drum-generated.png')
damage_raw = load_image('destroyed-hull-with-drum-generated.png')
turret_raw = load_image('turret-centered-generated.png')
hull_box = solid_bounds(hull_raw)
turret_box = solid_bounds(turret_raw)
hull = hull_raw.crop(hull_box)
turret = turret_raw.crop(turret_box)

# One uniform physical scale for each source; no independent axis stretching.
# Body ends at row 1619; the rear fuel drum remains outside that body extent.
turret_scale = hull.width * 0.85 / turret.width
turret = turret.resize((round(turret.width * turret_scale), round(turret.height * turret_scale)), Image.Resampling.LANCZOS)
turret_xy = (round((hull.width - turret.width) / 2), round((1619 - hull_box[1]) * 0.90 - turret.height))
top_space = max(0, -turret_xy[1]) + 12
source_size = (hull.width + 32, top_space + hull.height + 12)
hull_xy = (16, top_space)
raw_xy = (hull_xy[0] - hull_box[0], hull_xy[1] - hull_box[1])

high_hull = Image.new('RGBA', source_size)
high_hull.alpha_composite(hull_raw, raw_xy)
high_damage = Image.new('RGBA', source_size)
# Identical source canvas and unchanged hull geometry: retain its exact placement.
# Intact broad hull rows differ by at most 1 source pixel, below 0.2 final pixels.
assert damage_raw.size == hull_raw.size
high_damage.alpha_composite(damage_raw, raw_xy)
high_turret = Image.new('RGBA', source_size)
high_turret.alpha_composite(turret, (hull_xy[0] + turret_xy[0], hull_xy[1] + turret_xy[1]))
Image.alpha_composite(high_hull, high_turret).save(ROOT / 'normal-assembled-source.png')

final_size = (112, 300)
scale = min(100 / hull.width, 288 / (source_size[1] - 24))
scaled_size = (round(source_size[0] * scale), round(source_size[1] * scale))
final_xy = ((final_size[0] - scaled_size[0]) // 2, (final_size[1] - scaled_size[1]) // 2)

def export(im, name):
    resized = im.resize(scaled_size, Image.Resampling.LANCZOS)
    final = Image.new('RGBA', final_size)
    final.alpha_composite(resized, final_xy)
    final.save(ROOT / name)
    return final

final_hull = export(high_hull, 'maus_top_hull_candidate.png')
final_turret = export(high_turret, 'maus_top_turret_candidate.png')
final_damage = export(high_damage, 'maus_top_destroyed_candidate.png')
final_normal = Image.alpha_composite(final_hull, final_turret)
final_normal.save(ROOT / 'maus_top_candidate.png')

main_axis = sum(row_center(turret_raw, y) for y in [150, 300, 400]) / 3
body_axis = sum(row_center(turret_raw, y) for y in [1300, 1500, 1600]) / 3
axis_error_final_px = abs(main_axis - body_axis) * turret_scale * scale
assert axis_error_final_px < 0.6, axis_error_final_px
assert Image.alpha_composite(final_hull, final_turret).tobytes() == final_normal.tobytes()
for name in ['maus_top_hull_candidate.png', 'maus_top_turret_candidate.png', 'maus_top_candidate.png', 'maus_top_destroyed_candidate.png']:
    im = Image.open(ROOT / name)
    assert im.size == final_size and im.mode == 'RGBA'
    assert im.getchannel('A').getextrema() == (0, 255)
    print(name, im.size, 'RGBA / transparency / size: OK')
print('Main barrel horizontal center error at final size:', round(axis_error_final_px, 3), 'px')
print('Normal is exact alpha composite of final hull and turret: OK')

manifest = {
    'status': 'awaiting_user_confirmation', 'revision': 2,
    'final_canvas': final_size, 'front': 'up',
    'hull_source_bounds': hull_box, 'turret_source_bounds': turret_box,
    'source_canvas': source_size, 'source_hull_raw_offset': raw_xy,
    'source_turret_offset': [hull_xy[0] + turret_xy[0], hull_xy[1] + turret_xy[1]],
    'turret_uniform_scale': turret_scale, 'final_uniform_scale': scale,
    'final_offset': final_xy, 'main_barrel_axis_error_final_px': axis_error_final_px,
    'destroyed_basis': 'hull-with-drum-generated.png only; turret completely absent',
    'destroyed_alignment': 'same source canvas and same placement, no independent tight crop or resize',
    'approved_for_project_replacement': False,
}
(ROOT / 'candidate-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

font = 'C:/Windows/Fonts/msyh.ttc'
title_font = ImageFont.truetype(font, 22)
label_font = ImageFont.truetype(font, 18)
small_font = ImageFont.truetype(font, 14)
board = Image.new('RGB', (560, 430), '#e4e5df')
draw = ImageDraw.Draw(board)
draw.text((20, 12), '鼠式修改稿 · 第二版', font=title_font, fill='#252d29')
draw.text((20, 47), '112 × 300 px · 透明贴图 · 待确认', font=small_font, fill='#4b554d')
for x, im, label in [(34, final_normal, '正常'), (224, final_hull, '车身'), (414, final_damage, '击毁（车身）')]:
    label_width = draw.textbbox((0, 0), label, font=label_font)[2]
    draw.text((x + 56 - label_width / 2, 77), label, font=label_font, fill='#252d29')
    draw.rounded_rectangle((x - 12, 106, x + 124, 419), radius=7, fill='#65735c')
    board.paste(im, (x, 113), im)
board.save(ROOT / 'review-preview-1x.png')
board.resize((1120, 860), Image.Resampling.NEAREST).save(ROOT / 'review-preview-2x.png')

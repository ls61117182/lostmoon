from pathlib import Path
import json
import shutil
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parent / 'revision-02'
previous = json.loads((PREVIOUS / 'candidate-manifest.json').read_text(encoding='utf-8'))

def load_image(name):
    image = Image.open(ROOT / name).convert('RGBA')
    image.putalpha(image.getchannel('A').point(lambda v: 0 if v < 10 else v))
    return image

def bounds(image):
    return image.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()

hull_raw = load_image('hull-base-generated.png')
damage_raw = load_image('destroyed-base-generated.png')
fuel_raw = load_image('fuel-drum-layer-generated.png')
fuel_box = bounds(fuel_raw)
fuel = fuel_raw.crop(fuel_box)
fuel_scale = (621 * 0.52) / fuel.width
fuel = fuel.resize((round(fuel.width * fuel_scale), round(fuel.height * fuel_scale)), Image.Resampling.LANCZOS)

# Reuse the previous common source canvas, scale and offsets. The shorter rear
# overhang must not enlarge the vehicle or change the accepted turret placement.
source_size = tuple(previous['source_canvas'])
raw_offset = tuple(previous['source_hull_raw_offset'])
scale = previous['final_uniform_scale']
final_offset = tuple(previous['final_offset'])
final_size = tuple(previous['final_canvas'])
scaled_size = tuple(round(v * scale) for v in source_size)

high_hull_base = Image.new('RGBA', source_size)
high_hull_base.alpha_composite(hull_raw, raw_offset)

# Align the damaged source by intact front/rear hull edges; this is a single
# uniform transform. Fuel is subsequently the very same layer for both states.
damage_scale = (1623 - 49) / (1570 - 43)
damage_raw = damage_raw.resize((round(damage_raw.width * damage_scale), round(damage_raw.height * damage_scale)), Image.Resampling.LANCZOS)
damage_align = (round(422.5 - 460.5 * damage_scale), round(49 - 43 * damage_scale))
high_damage_base = Image.new('RGBA', source_size)
high_damage_base.alpha_composite(damage_raw, (raw_offset[0] + damage_align[0], raw_offset[1] + damage_align[1]))

# In raw intact-hull coordinates, rear edge is y=1622 and the drum's center is
# put on that edge. One half of the cylinder overlays armor, one half protrudes.
rear_edge = 1622
fuel_xy_raw = (round(422.5 - fuel.width / 2), round(rear_edge - fuel.height / 2))
fuel_xy = (fuel_xy_raw[0] + raw_offset[0], fuel_xy_raw[1] + raw_offset[1])
high_fuel = Image.new('RGBA', source_size)
high_fuel.alpha_composite(fuel, fuel_xy)
high_hull = Image.alpha_composite(high_hull_base, high_fuel)
high_damage = Image.alpha_composite(high_damage_base, high_fuel)
inside_fraction = (rear_edge - fuel_xy_raw[1]) / fuel.height
assert abs(inside_fraction - 0.5) < 0.01

def export(image, filename):
    final = Image.new('RGBA', final_size)
    final.alpha_composite(image.resize(scaled_size, Image.Resampling.LANCZOS), final_offset)
    final.save(ROOT / filename)
    return final

final_hull = export(high_hull, 'maus_top_hull_candidate.png')
final_damage = export(high_damage, 'maus_top_destroyed_candidate.png')
export(high_fuel, 'maus_rear_fuel_drum_candidate.png')
shutil.copyfile(PREVIOUS / 'maus_top_turret_candidate.png', ROOT / 'maus_top_turret_candidate.png')
final_turret = Image.open(ROOT / 'maus_top_turret_candidate.png').convert('RGBA')
final_normal = Image.alpha_composite(final_hull, final_turret)
final_normal.save(ROOT / 'maus_top_candidate.png')
high_hull.save(ROOT / 'hull-composed-source.png')
high_damage.save(ROOT / 'destroyed-composed-source.png')

for filename in ['maus_top_candidate.png', 'maus_top_hull_candidate.png', 'maus_top_turret_candidate.png', 'maus_top_destroyed_candidate.png', 'maus_rear_fuel_drum_candidate.png']:
    image = Image.open(ROOT / filename)
    assert image.size == final_size and image.mode == 'RGBA'
    assert image.getchannel('A').getextrema() == (0, 255)
    print(filename, image.size, 'RGBA / transparency / <=300px: OK')
assert (ROOT / 'maus_top_turret_candidate.png').read_bytes() == (PREVIOUS / 'maus_top_turret_candidate.png').read_bytes()
print('Turret unchanged from centered revision 02: exact file match OK')
print('Fuel overlap inside hull:', round(inside_fraction * 100, 2), '%; same fuel layer/offset in both states')
print('Fuel silhouette aspect ratio:', round(fuel.width / fuel.height, 3))

manifest = dict(previous)
manifest.update({
    'revision': 3, 'status': 'awaiting_user_confirmation',
    'reference': 'user-reference.png',
    'fuel_source_bounds': fuel_box, 'fuel_uniform_scale': fuel_scale,
    'fuel_size_in_common_source': fuel.size,
    'fuel_offset_in_common_source': fuel_xy,
    'fuel_inside_fraction': inside_fraction,
    'fuel_silhouette_aspect_ratio': fuel.width / fuel.height,
    'rear_edge_in_common_source': rear_edge + raw_offset[1],
    'destroyed_source_uniform_scale': damage_scale,
    'destroyed_source_alignment': damage_align,
    'turret': 'exact PNG reused from revision 02',
    'destroyed_basis': 'hull only, with identical separate rear fuel layer',
    'destroyed_alignment': 'intact nose/rear hull edges, uniform scale and translation; fuel shares exact coordinates',
    'approved_for_project_replacement': False,
})
(ROOT / 'candidate-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

font = 'C:/Windows/Fonts/msyh.ttc'
title_font = ImageFont.truetype(font, 22)
label_font = ImageFont.truetype(font, 18)
small_font = ImageFont.truetype(font, 14)
board = Image.new('RGB', (560, 430), '#e4e5df')
draw = ImageDraw.Draw(board)
draw.text((20, 12), '鼠式修改稿 · 油桶形状与位置修正', font=title_font, fill='#252d29')
draw.text((20, 47), '112 × 300 px · 透明贴图 · 待确认', font=small_font, fill='#4b554d')
for x, image, label in [(34, final_normal, '正常'), (224, final_hull, '车身'), (414, final_damage, '击毁（车身）')]:
    width = draw.textbbox((0, 0), label, font=label_font)[2]
    draw.text((x + 56 - width / 2, 77), label, font=label_font, fill='#252d29')
    draw.rounded_rectangle((x - 12, 106, x + 124, 419), radius=7, fill='#65735c')
    board.paste(image, (x, 113), image)
board.save(ROOT / 'review-preview-1x.png')
board.resize((1120, 860), Image.Resampling.NEAREST).save(ROOT / 'review-preview-2x.png')

# Rear detail QA view. The line is only a guide in the preview, never in assets.
detail = Image.new('RGB', (820, 340), '#e4e5df')
dd = ImageDraw.Draw(detail)
dd.text((18, 10), '车尾局部：油桶约一半压在车身内', font=title_font, fill='#252d29')
crop_box = (raw_offset[0] + 80, raw_offset[1] + 1450, raw_offset[0] + 760, raw_offset[1] + 1750)
for x, image, label in [(18, high_hull, '正常车身'), (422, high_damage, '击毁车身')]:
    crop = image.crop(crop_box)
    crop = crop.resize((380, 168), Image.Resampling.LANCZOS)
    bg = Image.new('RGBA', crop.size, '#65735c')
    bg.alpha_composite(crop)
    detail.paste(bg.convert('RGB'), (x, 100))
    guide_y = 100 + round((rear_edge + raw_offset[1] - crop_box[1]) * 168 / (crop_box[3] - crop_box[1]))
    dd.line((x, guide_y, x + 380, guide_y), fill='#e2b458', width=2)
    dd.text((x, 64), label, font=label_font, fill='#252d29')
dd.text((18, 292), '金线标记车尾边界，仅用于预览；正式贴图不含金线。', font=small_font, fill='#4b554d')
detail.save(ROOT / 'rear-detail-check.png')

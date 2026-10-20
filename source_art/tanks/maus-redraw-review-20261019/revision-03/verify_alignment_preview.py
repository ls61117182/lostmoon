from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parent
hull = Image.open(ROOT / 'maus_top_hull_candidate.png').convert('RGBA')
damage = Image.open(ROOT / 'maus_top_destroyed_candidate.png').convert('RGBA')
fuel = Image.open(ROOT / 'maus_rear_fuel_drum_candidate.png').convert('RGBA')
assert hull.size == damage.size == fuel.size == (112, 300)

columns = [20, 24, 27, 85, 89, 92]
def rear_rows(image):
    alpha = image.getchannel('A')
    return {str(x): max(y for y in range(240, 300) if alpha.getpixel((x, y)) > 128) for x in columns}

normal_rear = rear_rows(hull)
destroyed_rear = rear_rows(damage)
assert normal_rear == destroyed_rear
assert set(normal_rear.values()) == {268}
fuel_box = fuel.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
assert fuel_box == (31, 256, 81, 283)

# The exposed lower fuel half has no hull beneath it, so both composites must
# have the exact same pixels there, beyond merely sharing a placement config.
outside_roi = (31, 271, 81, 283)
outside_diff = ImageChops.difference(hull.crop(outside_roi), damage.crop(outside_roi))
max_channel_diff = max(high for low, high in outside_diff.getextrema())
assert max_channel_diff <= 1, max_channel_diff

report = {
    'inputs': ['maus_top_hull_candidate.png', 'maus_top_destroyed_candidate.png', 'maus_rear_fuel_drum_candidate.png'],
    'size': hull.size, 'rear_sample_columns': columns,
    'normal_rear_rows': normal_rear, 'destroyed_rear_rows': destroyed_rear,
    'shared_fuel_bounds_alpha_gt_128': fuel_box,
    'exposed_fuel_pixel_max_difference_0_to_255': max_channel_diff,
    'preview_crop': [0, 235, 112, 290], 'preview_scale': 3,
    'note': 'Preview uses final candidate PNGs only; identical crop and scale. No generated drafts.'
}
(ROOT / 'alignment-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

font_path = 'C:/Windows/Fonts/msyh.ttc'
title_font = ImageFont.truetype(font_path, 23)
label_font = ImageFont.truetype(font_path, 18)
small_font = ImageFont.truetype(font_path, 14)
board = Image.new('RGB', (760, 335), '#e4e5df')
draw = ImageDraw.Draw(board)
draw.text((18, 12), '最终 PNG 对照：同一裁切范围、同一放大倍数', font=title_font, fill='#252d29')
crop_box = (0, 235, 112, 290)
for x, sprite, label in [(18, hull, '正常车身'), (406, damage, '击毁车身')]:
    draw.text((x, 62), label, font=label_font, fill='#252d29')
    crop = sprite.crop(crop_box).resize((336, 165), Image.Resampling.NEAREST)
    pane = Image.new('RGBA', crop.size, '#65735c')
    pane.alpha_composite(crop)
    board.paste(pane.convert('RGB'), (x, 100))
    for row, color in [(256, '#67d4e2'), (269, '#edc468'), (283, '#67d4e2')]:
        y = 100 + (row - crop_box[1]) * 3
        draw.line((x, y, x + 336, y), fill=color, width=1)
draw.text((18, 285), '金线：两张车身的实际车尾边界；蓝线：共同油桶层的上下缘。', font=small_font, fill='#4b554d')
draw.text((18, 310), '辅助线仅用于核对，正式透明贴图中不含线。', font=small_font, fill='#4b554d')
board.save(ROOT / 'verified-final-alignment.png')

# A same-frame toggle makes any real translation immediately visible.
frames = []
for sprite, label in [(hull, '正常车身'), (damage, '击毁车身')]:
    frame = Image.new('RGB', (460, 280), '#e4e5df')
    fd = ImageDraw.Draw(frame)
    fd.text((12, 8), label + ' · 最终 PNG', font=title_font, fill='#252d29')
    crop = sprite.crop(crop_box).resize((448, 220), Image.Resampling.NEAREST)
    pane = Image.new('RGBA', crop.size, '#65735c')
    pane.alpha_composite(crop)
    frame.paste(pane.convert('RGB'), (6, 48))
    fd.line((6, 48 + (269 - 235) * 4, 454, 48 + (269 - 235) * 4), fill='#edc468', width=1)
    frames.append(frame)
frames[0].save(ROOT / 'verified-final-toggle.gif', save_all=True, append_images=frames[1:], duration=800, loop=0)
print(json.dumps(report, ensure_ascii=False))

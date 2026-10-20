from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent

def clean_crop(name):
    image = Image.open(ROOT / name).convert('RGBA')
    alpha = image.getchannel('A')
    bounds = alpha.point(lambda v: 255 if v > 128 else 0).getbbox()
    image.putalpha(alpha.point(lambda v: 0 if v < 10 else v))
    return image.crop(bounds), bounds

hull, hull_bounds = clean_crop('hull-generated.png')
turret, turret_bounds = clean_crop('turret-final-generated.png')
# One physical scale; turret width is calibrated to the external plan.
turret_scale = hull.width * 0.85 / turret.width
turret = turret.resize((round(turret.width * turret_scale), round(turret.height * turret_scale)), Image.Resampling.LANCZOS)
turret_xy = (round((hull.width - turret.width) / 2), round(hull.height * 0.90 - turret.height))
offset = (12, max(0, -turret_xy[1]) + 12)
canvas_size = (hull.width + 24, hull.height + offset[1] + 12)
high_hull = Image.new('RGBA', canvas_size)
high_hull.alpha_composite(hull, offset)
high_turret = Image.new('RGBA', canvas_size)
high_turret.alpha_composite(turret, (offset[0] + turret_xy[0], offset[1] + turret_xy[1]))
normal = Image.alpha_composite(high_hull, high_turret)
normal.save(ROOT / 'normal-assembled-source.png')
scale = 300 / max(canvas_size)
final_size = tuple(round(v * scale) for v in canvas_size)
for name, im in [('maus_top_hull_candidate.png', high_hull), ('maus_top_turret_candidate.png', high_turret), ('maus_top_candidate.png', normal)]:
    im.resize(final_size, Image.Resampling.LANCZOS).save(ROOT / name)
final_hull = Image.open(ROOT / 'maus_top_hull_candidate.png').convert('RGBA')
final_turret = Image.open(ROOT / 'maus_top_turret_candidate.png').convert('RGBA')
Image.alpha_composite(final_hull, final_turret).save(ROOT / 'maus_top_candidate.png')
manifest = {
    'status': 'awaiting_user_review',
    'canvas': final_size,
    'front': 'up',
    'hull_source_bounds': hull_bounds,
    'turret_source_bounds': turret_bounds,
    'turret_uniform_scale_to_hull_source': turret_scale,
    'source_hull_offset': offset,
    'source_turret_offset': [offset[0] + turret_xy[0], offset[1] + turret_xy[1]],
    'notes': 'Candidate layers share an aligned canvas. Runtime pivots/muzzle/hatch coordinates must be measured when approved for integration.'
}
(ROOT / 'candidate-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
bg = Image.new('RGBA', normal.size, '#66745e')
bg.alpha_composite(normal)
bg.convert('RGB').resize(final_size, Image.Resampling.LANCZOS).save(ROOT / 'normal-check-on-green.png')
print(json.dumps(manifest))

if (ROOT / 'destroyed-generated.png').exists():
    damage = Image.open(ROOT / 'destroyed-generated.png').convert('RGBA')
    damage.putalpha(damage.getchannel('A').point(lambda v: 0 if v < 10 else v))
    # Match intact front/rear hull landmarks, preserving uniform scale.
    # Normal wide hull rows: 140..1805; generated damage: 155..1989.
    damage_scale = (1805 - 140) / (1989 - 155)
    damage = damage.resize((round(damage.width * damage_scale), round(damage.height * damage_scale)), Image.Resampling.LANCZOS)
    damage_canvas = Image.new('RGBA', canvas_size)
    damage_offset = (round(339 - 375 * damage_scale), round(140 - 155 * damage_scale))
    damage_canvas.alpha_composite(damage, damage_offset)
    damage_final = damage_canvas.resize(final_size, Image.Resampling.LANCZOS)
    damage_final.save(ROOT / 'maus_top_destroyed_candidate.png')
    manifest['destroyed_alignment'] = {'uniform_scale': damage_scale, 'source_offset': damage_offset, 'reference': 'front and rear intact hull edges'}
    (ROOT / 'candidate-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

    font_path = 'C:/Windows/Fonts/msyh.ttc'
    title_font = ImageFont.truetype(font_path, 21)
    label_font = ImageFont.truetype(font_path, 16)
    board = Image.new('RGB', (384, 410), '#e4e5df')
    draw = ImageDraw.Draw(board)
    draw.text((20, 12), '鼠式坦克 · 待确认候选', font=title_font, fill='#252d29')
    for x, name, label in [(50, 'maus_top_candidate.png', '正常'), (222, 'maus_top_destroyed_candidate.png', '击毁')]:
        draw.rounded_rectangle((x-12, 82, x+124, 396), radius=7, fill='#65735c')
        draw.text((x+37, 52), label, font=label_font, fill='#252d29')
        sprite = Image.open(ROOT / name).convert('RGBA')
        board.paste(sprite, (x, 89), sprite)
    board.save(ROOT / 'review-preview-1x.png')
    board.resize((768, 820), Image.Resampling.NEAREST).save(ROOT / 'review-preview-2x.png')
    for name in ['maus_top_hull_candidate.png', 'maus_top_turret_candidate.png', 'maus_top_candidate.png', 'maus_top_destroyed_candidate.png']:
        im = Image.open(ROOT / name)
        assert max(im.size) <= 300
        assert im.mode == 'RGBA'
        assert im.getchannel('A').getextrema() == (0, 255)
        print(name, im.size, 'RGBA / transparent / <=300px: OK')
    rebuilt = Image.alpha_composite(final_hull, final_turret)
    assert rebuilt.tobytes() == Image.open(ROOT / 'maus_top_candidate.png').convert('RGBA').tobytes()
    print('Normal = final hull + final turret: exact pixel match OK')

"""Build the wreck from the intact hull, with explicit local damage masks."""
from pathlib import Path
from datetime import datetime, timezone
from statistics import median
import json
import shutil
import hashlib
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
UNITS = ROOT / 'assets/resources/textures/units'
HULL_PATH = UNITS / 'maus_top_hull.png'

def rgba(path):
    return Image.open(path).convert('RGBA')

hull = rgba(SOURCE / 'before-maus_top_hull.png')
turret_before = rgba(SOURCE / 'before-maus_top_turret.png')
assert hull.size == (258, 99) and turret_before.size == (240, 83)
assert rgba(HULL_PATH).tobytes() == hull.tobytes(), 'Normal hull must not drift during this fix'
normal_hull_sha = hashlib.sha256(HULL_PATH.read_bytes()).hexdigest()

# Each damage mask is local. The original hull is the ONLY wreck base.
# No earlier destroyed image is read or used by this build.
wreck = hull.copy()
damage_mask = Image.new('L', hull.size, 0)
specs = [
    {'name': 'ring', 'box': (121,14,189,85), 'ellipse': (126,20,184,78)},
    {'name': 'grille', 'box': (55,65,96,94), 'ellipse': (79,75,94,92)},
    {'name': 'rear-panel', 'box': (182,50,224,84), 'ellipse': (208,65,222,81)},
]
for spec in specs:
    mask = Image.new('L', hull.size, 0)
    ImageDraw.Draw(mask).ellipse(spec['ellipse'], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.65)).point(lambda v: 0 if v < 8 else v)
    spec['mask_bounds'] = mask.getbbox()
    box = spec['box']
    generated = rgba(SOURCE / (spec['name'] + '-damage-generated.png'))
    generated = generated.resize((box[2]-box[0],box[3]-box[1]),Image.Resampling.LANCZOS)
    patch_canvas = hull.copy()
    patch_canvas.paste(generated, box[:2])
    wreck = Image.composite(patch_canvas, wreck, mask)
    damage_mask = ImageChops.lighter(damage_mask, mask)
wreck.putalpha(hull.getchannel('A'))

hull_pixels = list(hull.get_flattened_data())
wreck_pixels = list(wreck.get_flattened_data())
mask_values = list(damage_mask.get_flattened_data())
outside_count = 0
changed_count = 0
for original, destroyed, mask in zip(hull_pixels, wreck_pixels, mask_values):
    if mask == 0:
        assert original == destroyed, 'A normal hull detail outside the approved damage changed'
        outside_count += 1
    if original != destroyed:
        changed_count += 1
assert hull.getchannel('A').tobytes() == wreck.getchannel('A').tobytes()
assert hull.crop((228,20,258,80)).tobytes() == wreck.crop((228,20,258,80)).tobytes(), 'Rear drum must remain exact source pixels'

def material_median(image):
    selected = [p for p in image.get_flattened_data()
                if p[3] > 220 and 75 < sum(p[:3])/3 < 210 and max(p[:3])-min(p[:3]) < 50]
    return [median(p[c] for p in selected) for c in range(3)]

target = material_median(hull)
source = material_median(turret_before)
shift = [target[c]-source[c] for c in range(3)]
# Deterministic paint calibration preserves every structure, alpha and dark line.
# Only armor RGB is adjusted; no turret redraw, resize or regenerated features.
for attempt in range(6):
    turret = turret_before.copy()
    output = []
    locked_line_count = 0
    for p in turret_before.get_flattened_data():
        r,g,b,a = p
        luminance = (r+g+b)/3
        weight = min(1.0,max(0.0,(luminance-60)/35)) if a else 0.0
        rgb = tuple(max(0,min(255,round(p[c]+shift[c]*weight))) for c in range(3))
        corrected = (*rgb,a)
        if luminance <= 60 or not a:
            assert corrected == p
            locked_line_count += 1
        output.append(corrected)
    turret.putdata(output)
    after = material_median(turret)
    if max(abs(after[c]-target[c]) for c in range(3)) <= 0.5:
        break
    shift = [shift[c]+target[c]-after[c] for c in range(3)]
assert turret.getchannel('A').tobytes() == turret_before.getchannel('A').tobytes()
after = material_median(turret)
assert max(abs(after[c]-target[c]) for c in range(3)) <= 1, (target,after)

top = Image.new('RGBA',(298,99))
top.alpha_composite(hull,(20,0))
top.alpha_composite(turret,(0,9))
assert max(top.size) <= 300

stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
backup = ROOT / 'asset_backups/latest/maus' / (stamp + '_before_base_hull_damage_and_paint_fix')
backup.mkdir(parents=True,exist_ok=False)
protected = [ROOT/'data/tank_visuals.csv', ROOT/'assets/scripts/core/TankVisualDB.ts', ROOT/'source_art/tanks/german-late-war/asset-report.json']
for folder in [UNITS,UNITS/'late_war']:
    for suffix in ['', '_hull','_turret','_destroyed']:
        path = folder / ('maus_top'+suffix+'.png')
        protected.extend([path,Path(str(path)+'.meta')])
for path in protected:
    destination = backup / path.relative_to(ROOT)
    if destination.suffix == '.ts':
        destination = destination.with_name(destination.name+'.bak')
    destination.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(path,destination)

# Keep the intact hull FILE unchanged. Only wreck, corrected turret and composed
# normal view change; their dimensions/UUIDs and all runtime geometry stay fixed.
for suffix,image in [('',top),('_turret',turret),('_destroyed',wreck)]:
    path = UNITS / ('maus_top'+suffix+'.png')
    assert rgba(path).size == image.size
    image.save(path)
    image.save(SOURCE / ('maus_top'+suffix+'-installed.png'))
assert hashlib.sha256(HULL_PATH.read_bytes()).hexdigest() == normal_hull_sha
damage_mask.save(ROOT / 'data/tank_art/maus_damage_mask.png')
damage_mask.save(SOURCE / 'damage-mask.png')

report = {
    'revision':5, 'status':'installed_for_in_game_review',
    'normal_hull_file_unchanged':True, 'normal_hull_sha256':normal_hull_sha,
    'wreck_base':'current intact maus_top_hull.png only',
    'damage_regions':specs,
    'unchanged_pixels_outside_damage_mask':outside_count,
    'changed_pixels_inside_damage_mask':changed_count,
    'outside_damage_pixels_exactly_equal':True,
    'alpha_silhouette_identical':True,
    'fuel_pixels_exactly_equal':True,
    'turret_color':{'before_median_rgb':source,'hull_reference_median_rgb':target,'after_median_rgb':after,'rgb_shift':shift,'dark_and_transparent_pixels_locked':locked_line_count},
    'runtime_geometry':'unchanged from revision 04; hull pivot (155,49), turret pivot (175,40)',
    'backup':str(backup.relative_to(ROOT)),
}
(SOURCE/'game-integration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

font='C:/Windows/Fonts/msyh.ttc'
title=ImageFont.truetype(font,22);small=ImageFont.truetype(font,17)
board=Image.new('RGB',(880,470),'#e4e5df');d=ImageDraw.Draw(board)
d.text((18,12),'鼠式修正：同一车身底图，只增加局部毁坏',font=title,fill='#252d29')
diff_view=hull.copy()
pix=list(diff_view.get_flattened_data())
for i,(a,b) in enumerate(zip(hull_pixels,wreck_pixels)):
    if a!=b:
        pix[i]=(239,143,45,a[3])
diff_view.putdata(pix)
for x,y,image,label in [(18,90,hull,'正常车身（原图未改）'),(455,90,wreck,'新击毁图'),(18,310,top,'炮塔与车身统一灰色'),(480,310,diff_view,'橙色：实际发生变化的像素')]:
    d.text((x,y-30),label,font=small,fill='#252d29')
    im=image.resize((image.width*3//2,image.height*3//2),Image.Resampling.NEAREST)
    pane=Image.new('RGBA',im.size,'#65735c');pane.alpha_composite(im)
    board.paste(pane.convert('RGB'),(x,y))
board.save(SOURCE/'installed-fix-preview.png')

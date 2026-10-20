from pathlib import Path
from datetime import datetime, timezone
import json
import csv
import io
import shutil
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
UNITS = ROOT / 'assets/resources/textures/units'
CSV = ROOT / 'data/tank_visuals.csv'
DB = ROOT / 'assets/scripts/core/TankVisualDB.ts'

def rgba(name):
    return Image.open(SOURCE / name).convert('RGBA')

normal_before = rgba('hull-before.png')
wreck_before = rgba('destroyed-before.png')
turret = rgba('turret-unchanged.png')
assert normal_before.size == wreck_before.size == (258, 99)

# Only the old/new seat area may be painted. Exterior, fuel drum and all other
# panels remain source pixels; the generated patch is never a replacement hull.
patch_box = (90, 10, 200, 88)
mask = Image.new('L', normal_before.size, 0)
md = ImageDraw.Draw(mask)
for center in [(138, 49), (155, 49)]:
    md.ellipse((center[0]-32, center[1]-32, center[0]+32, center[1]+32), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(0.7))

def patch(base, name):
    result = base.copy()
    generated = rgba(name).resize((110, 78), Image.Resampling.LANCZOS)
    patch_canvas = base.copy()
    patch_canvas.paste(generated, patch_box[:2])
    result = Image.composite(patch_canvas, result, mask)
    result.putalpha(base.getchannel('A'))
    return result

hull = patch(normal_before, 'hull-ring-patch-generated.png')
# Fill any missing edge pixels from the exact normal chassis before applying
# damage, then constrain alpha to the normal outline. Canvas size alone is not
# enough: this makes the entire visible silhouette identical pixel for pixel.
wreck_base = Image.alpha_composite(normal_before, wreck_before)
wreck = patch(wreck_base, 'destroyed-ring-patch-generated.png')
wreck.putalpha(hull.getchannel('A'))
assert hull.getchannel('A').tobytes() == wreck.getchannel('A').tobytes()
# Fuel and exterior alpha are unchanged from the accepted intact chassis.
assert hull.getchannel('A').tobytes() == normal_before.getchannel('A').tobytes()
assert hull.crop((228, 20, 258, 80)).tobytes() == normal_before.crop((228, 20, 258, 80)).tobytes()

hull_pivot = (155, 49)
turret_pivot = (175, 40)
offset = (hull_pivot[0] - turret_pivot[0], hull_pivot[1] - turret_pivot[1])
assert offset == (-20, 9), 'Intact turret placement must stay unchanged'
top = Image.new('RGBA', (298, 99))
top.alpha_composite(hull, (20, 0))
top.alpha_composite(turret, (0, 9))
assert max(top.size) <= 300

# Measure the shifted ring interior in the edited patch; gray armor is brighter.
def ring_center(image):
    pixels = image.load()
    candidates = set()
    for y in range(24, 75):
        for x in range(112, 187):
            r, g, b, a = pixels[x, y]
            if a > 128 and (r+g+b)/3 < 100:
                candidates.add((x, y))
    components = []
    while candidates:
        seed = candidates.pop()
        component = {seed}
        pending = [seed]
        while pending:
            x, y = pending.pop()
            for neighbor in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if neighbor in candidates:
                    candidates.remove(neighbor)
                    component.add(neighbor)
                    pending.append(neighbor)
        components.append(component)
    largest = max(components, key=len)
    return [sum(x for x,y in largest)/len(largest), sum(y for x,y in largest)/len(largest)]

normal_center = ring_center(hull)
wreck_center = ring_center(wreck)
assert abs(normal_center[0] - 155) < 3, normal_center
assert abs(wreck_center[0] - 155) < 3, wreck_center

backup = ROOT / 'asset_backups/latest/maus' / (datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '_before_ring_width_fix')
backup.mkdir(parents=True, exist_ok=False)
protected = [CSV, DB, ROOT / 'source_art/tanks/german-late-war/asset-report.json']
for folder in [UNITS, UNITS/'late_war']:
    for suffix in ['', '_hull', '_turret', '_destroyed']:
        path = folder / ('maus_top'+suffix+'.png')
        protected.extend([path, Path(str(path)+'.meta')])
for path in protected:
    target = backup / path.relative_to(ROOT)
    if target.suffix == '.ts':
        target = target.with_name(target.name+'.bak')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)

for suffix, image in [('', top), ('_hull', hull), ('_destroyed', wreck)]:
    path = UNITS / ('maus_top'+suffix+'.png')
    assert Image.open(path).size == image.size, 'No metadata size change should be needed'
    image.save(path)
    image.save(SOURCE / ('maus_top'+suffix+'-installed.png'))

text = CSV.read_text(encoding='utf-8-sig')
lines = text.splitlines()
headers = next(csv.reader([lines[0]]))
updates = {
    'turretPivotX': 155, 'turretPivotY': 49,
    'turretSpritePivotX': 175, 'turretSpritePivotY': 40,
    'destroyedFitScale': 1, 'destroyedOffsetForward': 0, 'destroyedOffsetRight': 0,
    'notes': 'Confirmed redraw revision-04; wreck uses exact intact hull alpha silhouette; rear turret ring shifted +17 source pixels; both pivots shifted +17 to preserve turret art placement; shared rear fuel drum',
}
for i,line in enumerate(lines):
    if not line.startswith('maus,'):
        continue
    row = next(csv.reader([line]))
    for field,value in updates.items():
        row[headers.index(field)] = str(value)
    buffer = io.StringIO(newline='')
    csv.writer(buffer,lineterminator='').writerow(row)
    lines[i] = buffer.getvalue()
    break
else:
    raise RuntimeError('Missing Maus record')
CSV.write_bytes(b'\xef\xbb\xbf'+('\n'.join(lines)+'\n').encode('utf-8'))

report = {
    'revision':4, 'installed':True,
    'hull_and_wreck_size': hull.size,
    'alpha_silhouette_identical':True,
    'normal_alpha_unchanged':True,
    'fuel_pixels_unchanged':True,
    'ring_shift_rearward_source_pixels':17,
    'measured_ring_centers':{'normal':normal_center,'destroyed':wreck_center},
    'hull_pivot':hull_pivot,'turret_pivot':turret_pivot,
    'intact_turret_placement_offset':offset,
    'backup':str(backup.relative_to(ROOT)),
}
(SOURCE/'game-integration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

font='C:/Windows/Fonts/msyh.ttc'
large=ImageFont.truetype(font,22)
small=ImageFont.truetype(font,17)
board=Image.new('RGB',(880,440),'#e4e5df')
draw=ImageDraw.Draw(board)
draw.text((18,12),'鼠式更新：正常与击毁同轮廓，座圈向车尾后移',font=large,fill='#252d29')
for x,y,image,label in [(18,90,hull,'正常车身'),(455,90,wreck,'击毁车身'),(18,275,top,'正常合成图')]:
    draw.text((x,y-30),label,font=small,fill='#252d29')
    image=image.resize((image.width*3//2,image.height*3//2),Image.Resampling.NEAREST)
    pane=Image.new('RGBA',image.size,'#65735c');pane.alpha_composite(image)
    board.paste(pane.convert('RGB'),(x,y))
draw.text((480,300),'车身/残骸：258 × 99 px',font=small,fill='#252d29')
draw.text((480,336),'座圈转轴：155, 49',font=small,fill='#252d29')
draw.text((480,372),'两张透明轮廓逐像素一致',font=small,fill='#252d29')
board.save(SOURCE/'installed-fix-preview.png')

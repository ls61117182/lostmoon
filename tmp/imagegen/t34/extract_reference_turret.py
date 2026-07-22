from pathlib import Path
from PIL import Image, ImageDraw

source = Path(r"C:\Temp\codex-clipboard-a91ddaa0-40e4-4623-b219-42a64af139ec.png")
out = Path("tmp/imagegen/t34/t34_top_turret_reference_extract.png")

# Coordinates trace the turret and its gun from the supplied top-view panel.
# The crop includes no hull area outside this mask.
image = Image.open(source).convert("RGBA")
mask = Image.new("L", image.size, 0)
draw = ImageDraw.Draw(mask)
draw.polygon([
    (0, 519), (173, 519), (173, 487), (202, 487), (214, 451),
    (260, 420), (325, 399), (388, 410), (427, 438), (443, 472),
    (443, 530), (416, 557), (357, 583), (283, 590), (225, 570),
    (189, 544), (173, 544), (173, 533), (0, 533),
], fill=255)

rgba = image.copy()
rgba.putalpha(mask)
crop = rgba.crop((0, 390, 460, 600))
out.parent.mkdir(parents=True, exist_ok=True)
crop.save(out)

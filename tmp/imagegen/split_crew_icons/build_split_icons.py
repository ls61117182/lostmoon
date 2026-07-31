from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(r"E:\cocos\Project\Sherman")
SOURCE = Path(r"C:\Temp\codex-clipboard-56505277-b7c1-4c7c-8ff9-4cdd3f44e993.png")
OUT = ROOT / "assets/resources/textures/ui/crew_icons_source_split"
PREVIEW = ROOT / "tmp/imagegen/split_crew_icons/preview_checker.png"

# Coordinates are normalized from the displayed reference so the crop uses
# the attachment's real 2172x724 pixels rather than the scaled chat preview.
REFERENCE_WIDTH = 2044
REFERENCE_HEIGHT = 684
REFERENCE_CENTERS_X = (211, 618, 1024, 1430, 1836)
REFERENCE_CENTER_Y = 326
REFERENCE_CROP_SIZE = 360
NAMES = (
    "crew_icon_01_star.png",
    "crew_icon_02_crosshair.png",
    "crew_icon_03_shell.png",
    "crew_icon_04_steering.png",
    "crew_icon_05_radio.png",
)


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def remove_dark_panel(crop: Image.Image) -> Image.Image:
    source = crop.convert("RGBA")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    src = source.load()
    dst = output.load()

    # The panel remains below roughly 55 luma. The metal icon ramps from
    # medium gray to white, so a smooth luminance matte preserves its existing
    # shading and antialiasing without repainting any icon pixels.
    transparent_luma = 55.0
    opaque_luma = 145.0
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, source_alpha = src[x, y]
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            alpha = round(
                255.0
                * smoothstep((luma - transparent_luma) / (opaque_luma - transparent_luma))
                * (source_alpha / 255.0)
            )
            if alpha <= 2:
                dst[x, y] = (0, 0, 0, 0)
            else:
                dst[x, y] = (r, g, b, alpha)
    return output


def checkerboard(width: int, height: int, cell: int = 16) -> Image.Image:
    image = Image.new("RGBA", (width, height), (44, 44, 44, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(64, 64, 64, 255))
    return image


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)

    icons: list[Image.Image] = []
    centers_x = tuple(round(value * source.width / REFERENCE_WIDTH) for value in REFERENCE_CENTERS_X)
    center_y = round(REFERENCE_CENTER_Y * source.height / REFERENCE_HEIGHT)
    crop_size = round(REFERENCE_CROP_SIZE * source.width / REFERENCE_WIDTH)
    if crop_size % 2:
        crop_size += 1
    half = crop_size // 2
    for center_x, name in zip(centers_x, NAMES):
        box = (
            center_x - half,
            center_y - half,
            center_x + half,
            center_y + half,
        )
        icon = remove_dark_panel(source.crop(box))
        icon.save(OUT / name, optimize=True)
        icons.append(icon)

    preview_size = 180
    preview = checkerboard(preview_size * len(icons), preview_size)
    for index, icon in enumerate(icons):
        shown = icon.resize((preview_size, preview_size), Image.Resampling.LANCZOS)
        preview.alpha_composite(shown, (index * preview_size, 0))
    preview.save(PREVIEW, optimize=True)

    for name, icon in zip(NAMES, icons):
        alpha = icon.getchannel("A")
        bbox = alpha.point(lambda value: 255 if value > 2 else 0).getbbox()
        transparent = sum(1 for value in alpha.getdata() if value == 0)
        total = icon.width * icon.height
        print(
            f"{name}: size={icon.size}, alpha_bbox={bbox}, "
            f"transparent={transparent}/{total}, corner_alpha={alpha.getpixel((0, 0))}"
        )


if __name__ == "__main__":
    main()

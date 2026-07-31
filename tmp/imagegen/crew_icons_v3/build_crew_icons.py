from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(r"E:\cocos\Project\Sherman")
SOURCE = Path(r"C:\Temp\codex-clipboard-5b8b9146-56b2-4611-8d7a-0c977765afd1.png")
MACHINE_GUN = ROOT / "tmp/imagegen/crew_icons_v3/codriver_machinegun_alpha.png"
OUT = ROOT / "assets/resources/textures/ui/crew_icons_v3"
PREVIEW = ROOT / "tmp/imagegen/crew_icons_v3/crew_icons_preview.png"

SIZE = 100
SCALE = 4
GRAY = (168, 168, 168, 255)


def fit_alpha(alpha: Image.Image, max_width: int, max_height: int) -> Image.Image:
    bbox = alpha.point(lambda v: 255 if v >= 12 else 0).getbbox()
    if not bbox:
        raise RuntimeError("empty alpha mask")
    alpha = alpha.crop(bbox)
    scale = min(max_width / alpha.width, max_height / alpha.height)
    size = (max(1, round(alpha.width * scale)), max(1, round(alpha.height * scale)))
    return alpha.resize(size, Image.Resampling.LANCZOS)


def gray_from_alpha(alpha: Image.Image) -> Image.Image:
    image = Image.new("RGBA", alpha.size, GRAY)
    image.putalpha(alpha)
    return image


def center_on_canvas(symbol: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - symbol.width) // 2
    y = (SIZE - symbol.height) // 2
    canvas.alpha_composite(symbol, (x, y))
    return canvas


def draw_common_ring(draw: ImageDraw.ImageDraw) -> None:
    draw.ellipse((9 * SCALE, 9 * SCALE, 91 * SCALE, 91 * SCALE), outline=GRAY, width=5 * SCALE)


def finish_vector(large: Image.Image) -> Image.Image:
    return large.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def draw_driver() -> Image.Image:
    large = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(large)
    draw_common_ring(draw)
    center = (50 * SCALE, 50 * SCALE)
    for point in ((50 * SCALE, 12 * SCALE), (16 * SCALE, 70 * SCALE), (84 * SCALE, 70 * SCALE)):
        draw.line((center, point), fill=GRAY, width=5 * SCALE)
    draw.ellipse((46 * SCALE, 46 * SCALE, 54 * SCALE, 54 * SCALE), fill=GRAY)
    return finish_vector(large)


def draw_gunner() -> Image.Image:
    large = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(large)
    draw_common_ring(draw)
    # Four short crosshair marks reproduce the reference gunner emblem.
    for line in (
        (50, 3, 50, 16),
        (50, 84, 50, 97),
        (3, 50, 16, 50),
        (84, 50, 97, 50),
    ):
        draw.line(tuple(value * SCALE for value in line), fill=GRAY, width=5 * SCALE)
    draw.ellipse((39 * SCALE, 39 * SCALE, 61 * SCALE, 61 * SCALE), outline=GRAY, width=5 * SCALE)
    draw.ellipse((47 * SCALE, 47 * SCALE, 53 * SCALE, 53 * SCALE), fill=GRAY)
    return finish_vector(large)


def draw_loader() -> Image.Image:
    large = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(large)
    draw_common_ring(draw)
    # A bold circular loading motion with a simple breech block; no micro-detail.
    draw.arc(
        (28 * SCALE, 28 * SCALE, 72 * SCALE, 72 * SCALE),
        start=35,
        end=325,
        fill=GRAY,
        width=6 * SCALE,
    )
    draw.polygon(
        [
            (29 * SCALE, 34 * SCALE),
            (42 * SCALE, 31 * SCALE),
            (34 * SCALE, 44 * SCALE),
        ],
        fill=GRAY,
    )
    draw.rounded_rectangle(
        (44 * SCALE, 43 * SCALE, 59 * SCALE, 58 * SCALE),
        radius=3 * SCALE,
        fill=GRAY,
    )
    return finish_vector(large)


def draw_commander() -> Image.Image:
    large = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(large)
    draw_common_ring(draw)

    # Simplified peaked officer cap: crown, band, visor, one badge.
    draw.polygon(
        [
            (27 * SCALE, 47 * SCALE),
            (34 * SCALE, 35 * SCALE),
            (68 * SCALE, 39 * SCALE),
            (76 * SCALE, 49 * SCALE),
            (70 * SCALE, 55 * SCALE),
            (32 * SCALE, 55 * SCALE),
        ],
        fill=GRAY,
    )
    draw.rounded_rectangle(
        (29 * SCALE, 52 * SCALE, 72 * SCALE, 61 * SCALE),
        radius=2 * SCALE,
        fill=GRAY,
    )
    draw.polygon(
        [
            (33 * SCALE, 61 * SCALE),
            (67 * SCALE, 61 * SCALE),
            (58 * SCALE, 68 * SCALE),
            (38 * SCALE, 68 * SCALE),
            (27 * SCALE, 65 * SCALE),
        ],
        fill=GRAY,
    )
    draw.ellipse((48 * SCALE, 42 * SCALE, 54 * SCALE, 48 * SCALE), fill=(65, 65, 65, 255))
    return finish_vector(large)


def draw_codriver() -> Image.Image:
    source = Image.open(MACHINE_GUN).convert("RGBA")
    alpha = source.getchannel("A")
    alpha = fit_alpha(alpha, 58 * SCALE, 38 * SCALE)
    symbol = gray_from_alpha(alpha)

    large = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(large)
    draw_common_ring(draw)
    x = (large.width - symbol.width) // 2
    y = (large.height - symbol.height) // 2
    large.alpha_composite(symbol, (x, y))
    return finish_vector(large)


def validate(name: str, image: Image.Image) -> None:
    if image.size != (SIZE, SIZE) or image.mode != "RGBA":
        raise RuntimeError(f"{name}: invalid format {image.mode} {image.size}")
    alpha = image.getchannel("A")
    if alpha.getpixel((0, 0)) != 0:
        raise RuntimeError(f"{name}: corner is not transparent")
    visible = sum(1 for value in alpha.getdata() if value > 8)
    if not 250 <= visible <= 6000:
        raise RuntimeError(f"{name}: suspicious visible coverage {visible}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icons = {
        "crew_role_driver.png": draw_driver(),
        "crew_role_gunner.png": draw_gunner(),
        "crew_role_loader.png": draw_loader(),
        "crew_role_codriver.png": draw_codriver(),
        "crew_role_commander.png": draw_commander(),
    }
    for name, image in icons.items():
        validate(name, image)
        image.save(OUT / name, optimize=True)

    preview = Image.new("RGBA", (SIZE * len(icons), SIZE), (42, 42, 42, 255))
    for index, image in enumerate(icons.values()):
        preview.alpha_composite(image, (index * SIZE, 0))
    preview.save(PREVIEW, optimize=True)

    for name, image in icons.items():
        alpha = image.getchannel("A")
        bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
        print(f"{name}: {image.size}, alpha_bbox={bbox}, corner_alpha={alpha.getpixel((0, 0))}")


if __name__ == "__main__":
    main()

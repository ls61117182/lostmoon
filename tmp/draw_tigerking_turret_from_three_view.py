from pathlib import Path

from PIL import Image, ImageDraw


SCALE = 8
SIZE = (120, 50)
REFERENCE_HULL_BOUNDS = (197, 6, 666, 229)
TURRET_FULL_OFFSET_X = -40


def sp(point):
    return tuple(round(value * SCALE) for value in point)


def points(values):
    return [sp(value) for value in values]


def reference_point(point):
    left, top, right, bottom = REFERENCE_HULL_BOUNDS
    x, y = point
    return (
        (x - left) * 100 / (right - left) - TURRET_FULL_OFFSET_X,
        (y - top) * 50 / (bottom - top),
    )


def reference_points(values):
    return points([reference_point(value) for value in values])


def symmetrize_polygon(values, axis_y=26):
    result = list(values)
    for upper_index, lower_index in ((0, 7), (1, 6), (2, 5), (3, 4)):
        upper = values[upper_index]
        lower = values[lower_index]
        x = (upper[0] + lower[0]) / 2
        distance = ((axis_y - upper[1]) + (lower[1] - axis_y)) / 2
        result[upper_index] = (x, axis_y - distance)
        result[lower_index] = (x, axis_y + distance)
    return result


def ellipse(draw, box, fill, outline=None, width=1):
    draw.ellipse(
        tuple(round(value * SCALE) for value in box),
        fill=fill,
        outline=outline,
        width=round(width * SCALE),
    )


def rounded_rectangle(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(
        tuple(round(value * SCALE) for value in box),
        radius=round(radius * SCALE),
        fill=fill,
        outline=outline,
        width=round(width * SCALE),
    )


def main():
    image = Image.new("RGBA", (SIZE[0] * SCALE, SIZE[1] * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    outline = (25, 27, 29, 255)
    deep = (47, 53, 58, 255)
    side_top = (104, 116, 126, 255)
    side_upper = (94, 106, 116, 255)
    side_rear = (78, 88, 97, 255)
    side_lower = (65, 74, 82, 255)
    roof = (132, 145, 156, 255)
    roof_highlight = (145, 158, 168, 255)
    hatch = (117, 130, 140, 255)

    # Red barrel lines and muzzle rectangle from the annotated reference.
    rounded_rectangle(draw, (0, 24.2, 6.3, 28.1), 0.5, outline)
    rounded_rectangle(draw, (0.5, 24.8, 5.8, 27.5), 0.3, side_upper)
    rounded_rectangle(draw, (5.8, 24.2, 57.2, 27.7), 0.9, outline)
    rounded_rectangle(draw, (6.3, 24.9, 57.2, 27), 0.5, (113, 126, 136, 255))
    draw.polygon(points([(53, 22.5), (66.5, 20.5), (70.5, 23), (70.5, 28), (66.5, 30.5), (53, 29)]), fill=outline)
    draw.polygon(points([(55, 24), (66, 22.5), (69, 24), (69, 27), (66, 28.5), (55, 27.5)]), fill=(105, 118, 128, 255))

    # Both polygons are traced from the black lines in the supplied overhead
    # technical drawing. These are not inferred offsets.
    outer_reference = [
        (332, 79),
        (416, 43),
        (464, 43),
        (571, 76),
        (571, 158),
        (464, 203),
        (416, 203),
        (332, 164),
    ]
    outer = [reference_point(value) for value in outer_reference]
    outer = symmetrize_polygon(outer)
    # Exact inner roof outline visible in the overhead drawing.
    inner_reference = [
        (344, 95),
        (416, 64),
        (462, 64),
        (558, 91),
        (558, 147),
        (463, 183),
        (417, 183),
        (344, 151),
    ]
    inner = [reference_point(value) for value in inner_reference]
    inner = symmetrize_polygon(inner)

    draw.polygon(points(outer), fill=deep)
    band_colors = [
        side_top,
        side_top,
        side_upper,
        side_rear,
        side_lower,
        side_lower,
        side_lower,
        side_upper,
    ]
    for index, color in enumerate(band_colors):
        next_index = (index + 1) % len(outer)
        draw.polygon(
            points([outer[index], outer[next_index], inner[next_index], inner[index]]),
            fill=color,
        )

    draw.polygon(points(inner), fill=roof)
    draw.line(points(outer + [outer[0]]), fill=outline, width=round(1.4 * SCALE), joint="curve")
    draw.line(points(inner + [inner[0]]), fill=outline, width=round(1.2 * SCALE), joint="curve")
    # Vertical front plate and mantlet retain the trapezoid's visible depth.
    draw.polygon(points([(67, 18.5), (72.5, 18), (72.5, 33), (67, 32)]), fill=outline)
    draw.polygon(points([(68.5, 20), (71, 19.5), (71, 31.5), (68.5, 31)]), fill=(91, 103, 112, 255))
    rounded_rectangle(draw, (65, 21.5, 70, 30.5), 1.5, side_rear, outline, 0.8)

    # Roof fittings use the positions visible inside the user's red boundary.
    rounded_rectangle(draw, (79.8, 18.8, 83.4, 23.8), 0.6, hatch, outline, 0.8)
    ellipse(draw, (89.2, 20.8, 93.2, 24.8), hatch, outline, 0.8)
    rounded_rectangle(draw, (94.8, 14.7, 99.5, 23.5), 1.0, hatch, outline, 0.8)

    ellipse(draw, (86.7, 25.8, 100.7, 39.8), side_lower, outline, 1.0)
    ellipse(draw, (88.2, 27.3, 99.2, 38.3), hatch, outline, 0.8)
    ellipse(draw, (89.5, 28.6, 97.9, 37), (128, 141, 151, 255), (60, 67, 72, 255), 0.7)
    rounded_rectangle(draw, (92.5, 34.8, 94.9, 38.8), 0.5, deep, outline, 0.5)

    ellipse(draw, (100.2, 24, 104.2, 28), hatch, outline, 0.7)
    ellipse(draw, (102, 30.5, 103.8, 32.3), deep, outline, 0.4)
    ellipse(draw, (102, 34.1, 103.8, 35.9), deep, outline, 0.4)

    image = image.resize(SIZE, Image.Resampling.LANCZOS)
    output = Path("assets/resources/textures/units/tigerking_top_turret.png")
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


if __name__ == "__main__":
    main()

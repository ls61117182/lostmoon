import { Color, Graphics } from 'cc';

/** Local sprite coordinates: the front of the tank points toward -X. */
export function drawSlippedTankTrack(g: Graphics, length: number, width: number, alpha = 1, position = 0.5, side: 'left' | 'right' = 'right') {
  const color = (r: number, green: number, blue: number, a = 255) => new Color(r, green, blue, Math.round(a * alpha));
  const linkWidth = Math.max(3, width * 0.13);
  // A quarter-turn with arc length = one quarter of hull length. The root is
  // beneath the original side track, tangent to it; the free end bends outward.
  const radius = length * 0.25 / (Math.PI / 2);
  const sideSign = side === 'right' ? 1 : -1;
  const rootX = length * (Math.max(1 / 3, Math.min(2 / 3, position)) - 0.5);
  const curve = (t: number) => {
    const angle = t * Math.PI / 2;
    return {
      x: rootX + radius * Math.sin(angle),
      y: sideSign * (width * 0.43 + radius * (1 - Math.cos(angle))),
    };
  };
  const samples = Array.from({ length: 49 }, (_, i) => curve(i / 48));
  const distances = [0];
  for (let i = 1; i < samples.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(
      samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  const total = distances[distances.length - 1];
  const atDistance = (distance: number) => {
    if (distance <= 0) return samples[0];
    if (distance >= total) return samples[samples.length - 1];
    const i = Math.max(1, distances.findIndex(d => d >= distance));
    const t = (distance - distances[i - 1]) / (distances[i] - distances[i - 1]);
    return {
      x: samples[i - 1].x + (samples[i].x - samples[i - 1].x) * t,
      y: samples[i - 1].y + (samples[i].y - samples[i - 1].y) * t,
    };
  };
  // Equal spacing keeps the track plates connected through the tight bend.
  const count = 6;
  const pitch = total / count;
  const shadowOffset = Math.max(0.6, width * 0.015);
  for (let i = 0; i < count; i++) {
    const from = atDistance(i * pitch);
    const to = atDistance((i + 1) * pitch);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const x = (from.x + to.x) * 0.5, y = (from.y + to.y) * 0.5;
    const halfLength = pitch * 0.49, halfWidth = linkWidth * 0.5;
    const point = (f: number, r: number, offset = 0) => ({
      x: x + ux * f - uy * r + offset,
      y: y + uy * f + ux * r - offset,
    });
    const plate = (offset: number) => {
      const corners = [point(-halfLength, -halfWidth, offset),
        point(halfLength, -halfWidth, offset), point(halfLength, halfWidth, offset),
        point(-halfLength, halfWidth, offset)];
      g.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) g.lineTo(corner.x, corner.y);
      g.close();
    };
    g.fillColor = color(18, 20, 19, 65);
    plate(shadowOffset);
    g.fill();
    g.fillColor = color(65, 67, 59);
    g.strokeColor = color(28, 30, 26);
    g.lineWidth = Math.max(0.65, width * 0.016);
    plate(0);
    g.fill();
    g.stroke();
    // A subdued transverse ridge follows each plate's own angle.
    g.strokeColor = color(102, 105, 91);
    g.lineWidth = Math.max(0.6, width * 0.014);
    const ridgeFrom = point(-pitch * 0.12, -halfWidth * 0.74);
    const ridgeTo = point(-pitch * 0.12, halfWidth * 0.74);
    g.moveTo(ridgeFrom.x, ridgeFrom.y);
    g.lineTo(ridgeTo.x, ridgeTo.y);
    g.stroke();
  }
}

/** A compact scorch at the gun root; no smoke, glowing fire, or broken barrel. */
export function drawTurretScorch(g: Graphics, radius: number, alpha = 1) {
  const color = (r: number, green: number, blue: number, a: number) => new Color(r, green, blue, Math.round(a * alpha));
  const polygon = (points: number[][], fill: Color) => {
    g.fillColor = fill;
    g.moveTo(points[0][0] * radius, points[0][1] * radius);
    for (const point of points.slice(1)) g.lineTo(point[0] * radius, point[1] * radius);
    g.close();
    g.fill();
  };
  polygon([[-1, 0.1], [-0.65, 0.75], [-0.15, 0.63], [0.5, 0.9], [1, 0.2], [0.65, -0.55], [-0.1, -0.8], [-0.8, -0.45]], color(51, 45, 34, 120));
  polygon([[-0.85, 0.05], [-0.43, 0.5], [0.06, 0.35], [0.55, 0.5], [0.7, -0.12], [0.15, -0.5], [-0.5, -0.48]], color(24, 26, 23, 220));
  g.strokeColor = color(9, 11, 10, 245);
  g.lineWidth = Math.max(1, radius * 0.20);
  g.moveTo(-radius * 0.7, radius * 0.12);
  g.lineTo(-radius * 0.15, -radius * 0.05);
  g.lineTo(radius * 0.15, radius * 0.3);
  g.lineTo(radius * 0.72, radius * 0.12);
  g.stroke();
}

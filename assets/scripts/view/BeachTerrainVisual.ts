import { Color, Graphics } from 'cc';

/** Native map art: strictly overhead footprints, no visible vertical faces. */
export function drawBeachOverlays(g: Graphics, x: number, y: number, size: number, crater: boolean, steel: boolean) {
  if (crater) {
    const colors = [new Color(166, 144, 109, 110), new Color(207, 184, 141, 175), new Color(190, 163, 118, 210), new Color(153, 129, 96, 230), new Color(130, 109, 82, 245), new Color(111, 94, 73, 245), new Color(99, 84, 66, 245)];
    for (let ring = 0; ring < colors.length; ring++) {
      g.fillColor = colors[ring];
      const radius = size * [.48, .44, .405, .365, .33, .285, .23][ring];
      for (let i = 0; i < 28; i++) {
        const a = i * Math.PI / 14, r = radius * (1 + .065 * Math.sin(i * 2.7) + .035 * Math.cos(i * .9));
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * .91;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.close(); g.fill();
    }
    // Sparse ejecta and bowl speckles soften the ring silhouette without perspective.
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, radius = size * (i < 15 ? .46 + .075 * Math.sin(i * 3.1) : .10 + .13 * Math.abs(Math.sin(i * 1.7)));
      g.fillColor = i % 2 ? new Color(115, 98, 75, 130) : new Color(177, 153, 114, 145);
      g.circle(x + Math.cos(a) * radius, y + Math.sin(a) * radius * .91, size * (.009 + .008 * Math.abs(Math.sin(i * 4.3)))); g.fill();
    }
  }
  if (steel) {
    // Exactly three obstacles per hex; the upright beam is an end-on square.
    for (const [dx, dy, angle] of [[-.38, .18, .15], [.34, .22, -.22], [.02, -.35, .48]]) {
      const cx = x + dx * size, cy = y + dy * size, arm = size * .17;
      for (const turn of [Math.PI / 4, -Math.PI / 4]) {
        const a = angle + turn, ux = Math.cos(a), uy = Math.sin(a);
        g.lineWidth = size * .075; g.strokeColor = new Color(47, 47, 44, 255);
        g.moveTo(cx - ux * arm, cy - uy * arm); g.lineTo(cx + ux * arm, cy + uy * arm); g.stroke();
        g.lineWidth = size * .042; g.strokeColor = new Color(99, 95, 84, 255);
        g.moveTo(cx - ux * arm, cy - uy * arm); g.lineTo(cx + ux * arm, cy + uy * arm); g.stroke();
      }
      g.fillColor = new Color(137, 114, 87, 255);
      g.rect(cx - size * .028, cy - size * .028, size * .056, size * .056); g.fill();
    }
  }
  g.lineWidth = 1;
}

export function drawBeachEdge(g: Graphics, x0: number, y0: number, x1: number, y1: number, size: number, kind: 'wire' | 'seawall', state = 1) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  if (kind === 'seawall') {
    // A continuous concrete top strip; no extrusion or side wall shading.
    for (const [width, color] of [[.13, new Color(86, 87, 79, 255)], [.095, new Color(171, 169, 153, 255)]] as const) {
      g.lineWidth = size * width; g.strokeColor = color;
      g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.strokeColor = new Color(115, 114, 102, 255); g.lineWidth = Math.max(.65, size * .012);
    for (let k = 1; k < 4; k++) {
      const x = x0 + dx * k / 4, y = y0 + dy * k / 4;
      g.moveTo(x - nx * size * .044, y - ny * size * .044); g.lineTo(x + nx * size * .044, y + ny * size * .044); g.stroke();
    }
  } else {
    const damaged = state === 2;
    g.strokeColor = damaged ? new Color(126, 116, 94, 170) : new Color(58, 57, 48, 255);
    g.lineWidth = Math.max(.8, size * .018);
    for (let k = 0; k < 7; k++) {
      if (damaged && k >= 2 && k <= 4) continue;
      const cx = x0 + dx * (k + .5) / 7, cy = y0 + dy * (k + .5) / 7;
      for (let i = 0; i <= 16; i++) {
        const a = i * Math.PI / 8, along = Math.cos(a) * len * .095, across = Math.sin(a) * size * (damaged ? .022 : .047);
        const px = cx + dx / len * along + nx * across, py = cy + dy / len * along + ny * across;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      // Short crossed barbs remain visible at map zoom.
      if (!damaged && k % 2 === 0) {
        g.moveTo(cx - size * .028, cy - size * .028); g.lineTo(cx + size * .028, cy + size * .028); g.stroke();
      }
    }
    g.fillColor = damaged ? new Color(115, 105, 83, 180) : new Color(65, 61, 50, 255);
    for (const f of [.12, .88]) { g.circle(x0 + dx * f, y0 + dy * f, size * .026); g.fill(); }
  }
  g.lineWidth = 1;
}

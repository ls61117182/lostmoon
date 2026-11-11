import { Color, Graphics, Label } from 'cc';

/** Shared materials for the operations desk. Colors express state at call sites. */
export const MILITARY_UI = {
  background: new Color(20, 28, 25),
  panel: new Color(41, 51, 45),
  inset: new Color(17, 25, 22),
  button: new Color(47, 59, 51),
  selected: new Color(79, 72, 48),
  brass: new Color(196, 163, 101),
  border: new Color(92, 105, 89),
  text: new Color(232, 228, 216),
  muted: new Color(157, 170, 155),
};

export function styleMilitaryLabel(label: Label): void {
  label.fontFamily = 'Microsoft YaHei';
  label.enableOutline = false;
}

export function drawMilitaryPanel(
  g: Graphics, w: number, h: number, fill: Color,
  border: Color = MILITARY_UI.border, accent: Color = MILITARY_UI.brass,
  inset = true, hover = 0, press = 0,
): void {
  const x = -w / 2, y = -h / 2;
  const radius = Math.min(3, w / 8, h / 8);
  g.fillColor = new Color(0, 0, 0, 24);
  g.roundRect(x - 2, y - 6 + press * 3, w + 4, h + 4, radius + 2); g.fill();
  g.fillColor = new Color(0, 0, 0, 65 - press * 30);
  g.roundRect(x, y - 3 + press * 2, w, h, radius); g.fill();
  g.fillColor = fill;
  g.roundRect(x, y, w, h, radius); g.fill();

  // Continuous shallow shading; no ornamental strokes cross button text.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    g.fillColor = t < 0.5
      ? new Color(234, 229, 203, (1 - t * 2) * (10 + hover * 7))
      : new Color(0, 0, 0, (t * 2 - 1) * (20 + press * 12));
    g.rect(x + 3, y + h - 3 - (i + 1) * (h - 6) / 12, w - 6, (h - 6) / 12 + 0.3);
    g.fill();
  }
  g.strokeColor = border;
  g.lineWidth = 1;
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius); g.stroke();
  g.strokeColor = new Color(242, 232, 196, 35 + hover * 35);
  g.moveTo(x + 4, y + h - 1.5); g.lineTo(x + w - 4, y + h - 1.5); g.stroke();

  if (inset && w > 40 && h > 40) {
    g.strokeColor = new Color(10, 17, 13, 120);
    g.roundRect(x + 5.5, y + 5.5, w - 11, h - 11, 2); g.stroke();
    // Sparse brushed marks stay near the shell, away from content.
    g.fillColor = new Color(232, 228, 216, 9);
    for (let i = 0; i < Math.min(40, Math.floor(w / 12)); i++) {
      g.rect(x + 12 + i * 11, y + h - 4, 3 + i % 4, 0.5); g.fill();
    }
    g.strokeColor = new Color(accent.r, accent.g, accent.b, 145);
    g.moveTo(x + 16, y + h - 0.5); g.lineTo(x + 44, y + h - 0.5); g.stroke();
    g.moveTo(x + w - 44, y + 0.5); g.lineTo(x + w - 16, y + 0.5); g.stroke();
  }
}

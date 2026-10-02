/** Positions for the numbered support markers inside a pointy-side hex. */
export function supportMarkerVisuals(
  rid: number | undefined,
  rf: number | undefined,
  eid: number | undefined,
  ef: number | undefined,
  radius: number,
): Array<{ kind: 'rid' | 'eid'; text: string; x: number; y: number }> {
  const entries = [
    { kind: 'rid' as const, id: rid, facing: rf },
    { kind: 'eid' as const, id: eid, facing: ef },
  ].filter(entry => Number.isInteger(entry.id) && entry.id! >= 1 && entry.id! <= 6);
  return entries.map((entry, index) => {
    const directed = Number.isInteger(entry.facing) && entry.facing! >= 0 && entry.facing! < 6;
    // Direction indices run clockwise from east in screen coordinates.
    const angle = directed ? -entry.facing! * Math.PI / 3 : 0;
    const distance = directed ? radius * 0.55 : 0;
    const overlap = entries.length === 2 && entries[1 - index]!.facing === entry.facing;
    const spread = overlap ? (index === 0 ? -1 : 1) * radius * (directed ? 0.25 : 0.20) : 0;
    return {
      kind: entry.kind,
      text: String.fromCodePoint(0x2460 + entry.id! - 1),
      x: Math.cos(angle) * distance + (directed ? -Math.sin(angle) * spread : spread),
      y: Math.sin(angle) * distance + (directed ? Math.cos(angle) * spread : 0),
    };
  });
}

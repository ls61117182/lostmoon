# Tiger art installed 2026-09-09

Appearance authority: ../approval-20260908/tiger-normal-preview-v6-aligned.png, explicitly approved by user. Hull and turret derived with built-in image_gen; wreck derived from hull. Prompts are in prompts.txt.

Prepared with data/tank_art/tiger.json and tools/prepareTankArt.cjs. All source layers use a 1950x807 canvas (one-pixel source width differences padded, not stretched), common scale 0.109, pivot (1160,386), muzzle (69,386), hatch (1270,495). Source chroma removed before resizing. Wreck alpha is copied exactly from hull.

Installed formal hull 151x85 (149px content length), turret 159x58, composed top 247x85, wreck 151x85. The top includes symmetric transparent gun clearance and is composed from the installed layers. Runtime turretScale=1 and turret offsets=0; aspectRatioMul=1. Existing hullFitScale=0.6755 retained. Fallback top fit is adjusted to maintain the same hull scale as split rendering.

Original PNGs, metadata, CSV and database are retained under before/; database backup uses .ts.bak to avoid TypeScript source discovery. tank:prepare also created its normal automatic backup.

Validation: pnpm run tank:validate PASS (23 resource audits, 7 tests, TypeScript). Additional check confirms byte-identical hull/wreck alpha and matching dimensions. Actual-size PNGs and nearest-neighbor previews visually inspected. Cocos running-game visual validation of turret rotation, commander overlay and muzzle effect is not performed in this session.

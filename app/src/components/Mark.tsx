/* The Flyleaf rosette — the SAME mark Press prints, character for character.
   `MARK` below is a byte-for-byte copy of `MARK` in
   ../Review app/app/src/cards/assets.ts. These are three distinct products but
   one family, and the family has one mark. What differs between them is how it
   is PRESENTED, which is the whole of this file's job.

   Press sets it bare: ink rosette on paper, one `fill="currentColor"`, nothing
   around it. This app REVERSES THE POLARITY — a solid ink block with the
   rosette knocked out of it, so the ground shows through the petals. A
   printer's block, which is the right idea for an app whose entire world is
   printed paper, and the only treatment considered that still tells the two
   apart at the 48px a home screen shrinks an icon to: same silhouette,
   opposite ink. A hairline frame or a ruled circle would have read fine in the
   nav and vanished in the icon — and the icon is the surface where being
   mistaken for Press actually costs something.

   Three facts about the geometry are load-bearing.

   1. `fill-rule="evenodd"` is what makes the hole, and it is safe because the
      rosette's six subpaths are mutually DISJOINT. Each petal is a whole
      ellipse (the two arcs share the major axis as their chord) 149.33 long by
      119.46 wide, centred 123.735 out from the middle. Its greatest angular
      half-width is 31.2°, against the 36° that 72° spacing allows, so no two
      petals meet; its inner vertex stops at r=49.07, against the centre disc's
      38.4, so no petal meets the disc. Nothing is therefore crossed twice by
      the rosette alone, and evenodd cancels exactly once — against the tile.
      Grow a petal and that sum has to be redone before the hole can be
      trusted.
   2. The tile is centred on the rosette's INK, not on the 512 box. The ink
      spans 64.94–447.06 horizontally (centred on 256) but 57.60–425.97
      vertically (centred on 241.78) — the rosette has a point up and two feet
      down, so it is not vertically symmetric. Hence the shifted `VIEWBOX`,
      which exists so that "centre the box" and "centre the ink" mean the same
      thing for every consumer.
   3. Tile and rosette are ONE `d` string under one plain `fill`. That is what
      lets the same three constants serve this component,
      scripts/make-icons.mjs and index.html's inline splash without a <mask>,
      a second element or any per-consumer cleverness. Three copies of the
      string exist because two of them run outside the bundle; they are kept in
      sync by hand and this file is the source. */

export const MARK = 'M256 57.6 A74.67 59.73 -90 1 1 256 206.93 A74.67 59.73 -90 1 1 256 57.6 Z M444.69 194.69 A74.67 59.73 -18 1 1 302.66 240.85 A74.67 59.73 -18 1 1 444.69 194.69 Z M372.61 416.51 A74.67 59.73 54 1 1 284.84 295.68 A74.67 59.73 54 1 1 372.61 416.51 Z M139.39 416.51 A74.67 59.73 126 1 1 227.16 295.68 A74.67 59.73 126 1 1 139.39 416.51 Z M67.31 194.69 A74.67 59.73 198 1 1 209.34 240.85 A74.67 59.73 198 1 1 67.31 194.69 Z M217.6 256 A38.4 38.4 0 1 1 294.4 256 A38.4 38.4 0 1 1 217.6 256 Z'

/* The block. A 582 square with 132 corners (0.227 of the side, the same ratio
   the home-screen tile has always used), positioned so its centre lands on the
   ink centre (256, 241.78) — hence the origin at -35,-49. 100 of clear ink
   either side of the rosette and 106.8 above and below it: a knockout needs
   more surround than a positive mark does, or the petal tips read as nicks in
   the edge rather than as a flower. */
export const TILE = 'M97 -49 H415 A132 132 0 0 1 547 83 V401 A132 132 0 0 1 415 533 H97 A132 132 0 0 1 -35 401 V83 A132 132 0 0 1 97 -49 Z'
export const VIEWBOX = '-35 -49 582 582'

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={VIEWBOX} aria-hidden="true" style={{ display: 'block' }}>
      <path d={`${TILE} ${MARK}`} fillRule="evenodd" fill="currentColor" />
    </svg>
  )
}

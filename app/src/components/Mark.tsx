/* The five-petal rosette, shared with Flyleaf Press. Same path, character for
   character — the two apps are the same brand and a redrawn mark is a second
   brand. It inherits colour: chrome is ink on paper, never terracotta. */

export const MARK =
  'M256 57.6 A74.67 59.73 -90 1 1 256 206.93 A74.67 59.73 -90 1 1 256 57.6 Z ' +
  'M444.69 194.69 A74.67 59.73 -18 1 1 302.66 240.85 A74.67 59.73 -18 1 1 444.69 194.69 Z ' +
  'M372.61 416.51 A74.67 59.73 54 1 1 284.84 295.68 A74.67 59.73 54 1 1 372.61 416.51 Z ' +
  'M139.39 416.51 A74.67 59.73 126 1 1 227.16 295.68 A74.67 59.73 126 1 1 139.39 416.51 Z ' +
  'M67.31 194.69 A74.67 59.73 198 1 1 209.34 240.85 A74.67 59.73 198 1 1 67.31 194.69 Z ' +
  'M217.6 256 A38.4 38.4 0 1 1 294.4 256 A38.4 38.4 0 1 1 217.6 256 Z'

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ display: 'block' }}>
      <path d={MARK} fill="currentColor" />
    </svg>
  )
}

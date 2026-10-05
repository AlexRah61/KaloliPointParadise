// `sizes` strings must describe the real rendered width (including object-fit: cover overscan),
// otherwise high-DPR screens are handed a smaller file and photos turn soft.
// Only media conditions + vw/vh/px/calc() are used, for consistent browser support.
export const SIZES = {
  container: '(min-width: 1520px) 1440px, 92vw',
  // Full-bleed frame: 3:2 photo in a frame ~78vh tall (4:3 on phones).
  bleed3x2: '(max-width: 767px) 113vw, (max-aspect-ratio: 1/1) calc(78vh * 1.5), 100vw',
  eightCols: '(min-width: 1000px) 62vw, 100vw',
  fiveCols: '(min-width: 1000px) 40vw, (min-width: 700px) 50vw, 100vw',
  fourCols: '(min-width: 1000px) 32vw, (min-width: 700px) 50vw, 92vw',
} as const;

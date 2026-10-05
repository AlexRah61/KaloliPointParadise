// WCAG contrast matrix for the design palette: node tools/contrast.mjs
const palette = {
  ink: '#151815', charcoal: '#242722', ivory: '#f4f0e7', stone: '#ddd6c8', sand: '#c7b79f',
  forest: '#30473a', moss: '#677463', bronze: '#a88255', bronzeLight: '#c6a77b', white: '#fffdf8',
  bronzeDeep: '#7d5f3a', mossDeep: '#55614f',
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const pairs = process.argv.slice(2).length ? [process.argv.slice(2)] : [
  ['bronze', 'ivory'], ['bronze', 'white'], ['bronzeDeep', 'ivory'], ['bronzeLight', 'ink'], ['bronze', 'ink'],
  ['ink', 'bronzeLight'], ['ink', 'bronze'], ['ivory', 'forest'], ['white', 'forest'], ['moss', 'ivory'], ['mossDeep', 'ivory'],
  ['charcoal', 'ivory'], ['ink', 'stone'], ['ink', 'sand'], ['stone', 'ink'], ['sand', 'ink'], ['ivory', 'charcoal'], ['moss', 'white'],
];
for (const [fg, bg] of pairs) {
  const r = ratio(palette[fg] ?? fg, palette[bg] ?? bg);
  console.log(`${fg.padEnd(12)} on ${bg.padEnd(12)} ${r.toFixed(2)}:1 ${r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA-large' : 'FAIL'}`);
}

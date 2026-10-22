// ISBN-10 and its ISBN-13 equivalent refer to the same edition.
export function canonicalISBN(value: string): string {
  const v = value.replace(/^ISBN(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(v) && [...v].reduce((s, d, i) => s + +d * (i % 2 ? 3 : 1), 0) % 10 === 0) return v;
  if (!/^\d{9}[\dX]$/.test(v) || [...v].reduce((s, d, i) => s + (d === "X" ? 10 : +d) * (10 - i), 0) % 11) return "";
  const base = `978${v.slice(0, 9)}`, check = (10 - [...base].reduce((s, d, i) => s + +d * (i % 2 ? 3 : 1), 0) % 10) % 10;
  return `${base}${check}`;
}

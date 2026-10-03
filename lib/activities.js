// Display names for the activity list (Activities › sub-activities).
//
// Sub-activities are stored with their category in the name — e.g.
// "Rcc ↳ Steel work", from the old Sheets layout — and saved DPR lines keep
// that stored name. Stored names stay as they are; everything that shows a
// sub-activity under its category shows just the task: "Steel work".

const LEADING_MARKS = /^[↳\s\-➔›]+/;
const SEPARATOR = /^[\s↳\-➔›:]/;

/**
 * "Rcc ↳ Steel work" → "Steel work"; "↳ Marble Flooring ↳ Wall Cladding"
 * → "Wall Cladding"; "Plastering" under "Plaster" stays "Plastering" (a
 * category prefix is only dropped at a word boundary). parentName is
 * optional — without it, only the text after the last ↳ is kept.
 */
export function taskName(name, parentName = '') {
  const full = String(name || '').trim();
  let s = (full.includes('↳') ? full.split('↳').pop() : full).replace(LEADING_MARKS, '').trim();
  const parent = String(parentName || '').trim();
  if (parent && s.toLowerCase().startsWith(parent.toLowerCase()) && SEPARATOR.test(s.substring(parent.length))) {
    s = s.substring(parent.length).replace(LEADING_MARKS, '').trim();
  }
  return s || full;
}

// The part of a stored name before the task ("Rcc ↳ "), kept on rename so
// a renamed task stays stored the same way as its siblings.
export function storedPrefix(name) {
  const full = String(name || '');
  const i = full.lastIndexOf('↳');
  return i < 0 ? '' : `${full.slice(0, i + 1)} `;
}

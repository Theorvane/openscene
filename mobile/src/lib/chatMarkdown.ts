/**
 * The little of Markdown a chat bubble on a phone should honour.
 *
 * Models write Markdown whether or not the prompt asks them to, and the bubble
 * was a plain `Text`: a reply listing what the assistant could and could not do
 * arrived as `- **Trim the second clip:** do that on the **Edit** tab`,
 * asterisks and all. Telling the model to stop is not a fix — it is a rule it
 * follows until the turn it does not, and that turn lands in front of the user.
 *
 * Bold only. It is almost all of what these replies use, and the rest —
 * headings, links, tables — has no place in a phone-sized bubble anyway. A
 * leading `- ` is left exactly as written: it already reads as a bullet.
 *
 * Split out from the component with no React Native import of its own, so the
 * parsing can be tested for what it does to a string rather than asserted
 * against the source that calls it.
 */

export type TextRun = {
  readonly text: string;
  readonly bold: boolean;
};

/** `s` matters: a bolded lead-in wraps onto the next line often enough. */
const BOLD = /\*\*(.+?)\*\*/gs;

/** The text split into runs, each flagged for whether it was wrapped in `**`. */
export function splitBold(source: string): readonly TextRun[] {
  const runs: TextRun[] = [];
  let index = 0;
  for (const match of source.matchAll(BOLD)) {
    const start = match.index;
    if (start > index) runs.push({ text: source.slice(index, start), bold: false });
    // The pattern has exactly one group, so a match always carries it; the
    // fallback is for the checker rather than for any string this can be given.
    runs.push({ text: match[1] ?? '', bold: true });
    index = start + match[0].length;
  }
  // An unclosed `**` leaves the tail unmatched, which is what keeps a truncated
  // reply visible instead of swallowing everything after the opening marker.
  if (index < source.length) runs.push({ text: source.slice(index), bold: false });
  return runs;
}

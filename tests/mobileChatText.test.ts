import { describe, expect, it } from 'vitest';

import { splitBold } from '../mobile/src/lib/chatMarkdown';

/**
 * Models write Markdown whether or not the prompt asks them to, and the bubble
 * was a plain `Text`, so a reply listing what the assistant could and could not
 * do arrived as `- **Trim the second clip:** do that on the **Edit** tab`.
 */

describe('chat text emphasis', () => {
  it('leaves text with no emphasis exactly as written', () => {
    expect(splitBold('I cannot export from here.')).toEqual([
      { text: 'I cannot export from here.', bold: false }
    ]);
  });

  it('lifts the emphasis out and drops the asterisks', () => {
    expect(splitBold('do that on the **Edit** tab')).toEqual([
      { text: 'do that on the ', bold: false },
      { text: 'Edit', bold: true },
      { text: ' tab', bold: false }
    ]);
  });

  it('handles several runs, including one that opens the line', () => {
    expect(splitBold('**Trim:** use **Edit**')).toEqual([
      { text: 'Trim:', bold: true },
      { text: ' use ', bold: false },
      { text: 'Edit', bold: true }
    ]);
  });

  it('leaves a lone or unclosed asterisk pair alone rather than eating the rest', () => {
    // A truncated reply ends mid-emphasis more often than anything else does,
    // and swallowing everything after it would hide the part that arrived.
    expect(splitBold('a **b')).toEqual([{ text: 'a **b', bold: false }]);
    expect(splitBold('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4', bold: false }]);
  });

  it('spans line breaks, because a bolded lead-in often wraps', () => {
    expect(splitBold('**one\ntwo** rest')).toEqual([
      { text: 'one\ntwo', bold: true },
      { text: ' rest', bold: false }
    ]);
  });
});

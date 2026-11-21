// Fast drop-in for csv-reader 1.0.0 (make.fun).
//
// Returns exactly what csv-reader 1.0.0 returns for every input {text, header},
// faster: one left-to-right pass over the text, fields cut out with substring
// slices instead of built up one character at a time, and a branch-minimal scan
// for the unquoted fields that make up most of a file. No dependencies, no
// state kept from one call to the next.
//
// The reading, as csv-reader 1.0.0 defines it:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (error quote_junk);
//   - a quote that never closes is a literal character and the text after it is
//     read again as unquoted (error unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, line the 1-based line its
//     record starts on, row its record index in rows, null for the header.

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let i = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;

  // Reads an unquoted field starting at startI on startLine, its value starting
  // with prefix. Rare path only (quote junk, unterminated quote): returns
  // [value, ended, endPos, endLine]. Stray CRs are dropped and reported.
  function scanUnquoted(startI, startLine, prefix, recLine, recRow) {
    let j = startI;
    let ln = startLine;
    let seg = startI;
    let acc = null;
    let ended = END;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c > 44) { j++; continue; }
      if (c === 44) { ended = COMMA; break; }
      if (c === 10) { ended = LINE_BREAK; break; }
      if (c === 13) {
        if (text.charCodeAt(j + 1) === 10) { ended = LINE_BREAK; break; }
        errors.push({ code: 'stray_cr', line: recLine, row: recRow });
        acc = (acc === null ? prefix : acc) + text.substring(seg, j);
        j++;
        seg = j;
        continue;
      }
      j++;
    }
    const value = acc === null ? prefix + text.substring(seg, j) : acc + text.substring(seg, j);
    if (ended === COMMA) j++;
    else if (ended === LINE_BREAK) {
      if (text.charCodeAt(j) === 13) j += 2;
      else j++;
      ln++;
    }
    return [value, ended, j, ln];
  }

  while (true) {
    // Lines with no characters are no records.
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) { i++; line++; }
      else if (c === 13 && text.charCodeAt(i + 1) === 10) { i += 2; line++; }
      else break;
    }
    if (i >= n) break;

    // The record being read: the line it starts on and the index in rows it takes.
    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = width < 0 ? [] : new Array(width);
    let extra = null;
    let fi = 0;
    let quotedLast = false;
    let ended = END;

    while (true) {
      let value;
      if (text.charCodeAt(i) === 34) {
        // A field that opens with a quote.
        quotedLast = true;
        const open = i;
        const openLine = line;
        i++;
        let seg = i;
        let acc = null;
        let closed = false;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c > 44) { i++; continue; }
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              acc = (acc === null ? text.substring(seg, i) : acc + text.substring(seg, i)) + '"';
              i += 2;
              seg = i;
              continue;
            }
            value = acc === null ? text.substring(seg, i) : acc + text.substring(seg, i);
            i++;
            closed = true;
            break;
          }
          if (c === 10) { line++; i++; continue; }
          if (c === 13) {
            // CRLF and a lone CR inside quotes are each one LF.
            line++;
            acc = (acc === null ? text.substring(seg, i) : acc + text.substring(seg, i)) + '\n';
            i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
            seg = i;
            continue;
          }
          i++;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after
          // it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = scanUnquoted(open + 1, openLine, '"', recordLine, recordRow);
          value = r[0];
          ended = r[1];
          i = r[2];
          line = r[3];
        } else if (i >= n) {
          ended = END;
        } else {
          const c = text.charCodeAt(i);
          if (c === 44) { i++; ended = COMMA; }
          else if (c === 10) { i++; line++; ended = LINE_BREAK; }
          else if (c === 13 && text.charCodeAt(i + 1) === 10) { i += 2; line++; ended = LINE_BREAK; }
          else {
            // What follows the closing quote is appended as it stands.
            const plen = value.length;
            const r = scanUnquoted(i, line, value, recordLine, recordRow);
            value = r[0];
            ended = r[1];
            i = r[2];
            line = r[3];
            if (value.length > plen) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
      } else {
        // An unquoted field: the hot path. Most characters are ordinary data, so
        // one check (code > 44) skips them all; only comma, LF and CR end it.
        quotedLast = false;
        let start = i;
        let acc = null;
        ended = END;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c > 44) { i++; continue; }
          if (c === 44) { ended = COMMA; break; }
          if (c === 10) { ended = LINE_BREAK; break; }
          if (c === 13) {
            if (text.charCodeAt(i + 1) === 10) { ended = LINE_BREAK; break; }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            acc = (acc === null ? '' : acc) + text.substring(start, i);
            i++;
            start = i;
            continue;
          }
          i++;
        }
        value = acc === null ? text.substring(start, i) : acc + text.substring(start, i);
        if (ended === COMMA) i++;
        else if (ended === LINE_BREAK) {
          if (text.charCodeAt(i) === 13) i += 2;
          else i++;
          line++;
        }
      }

      if (width < 0) fields.push(value);
      else if (fi < width) fields[fi] = value;
      else (extra ??= []).push(value);
      fi++;
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fi === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fi;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fi < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fi });
      for (let k = fi; k < width; k++) fields[k] = '';
    } else if (fi > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}

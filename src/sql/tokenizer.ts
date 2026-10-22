export type SegmentKind = 'code' | 'string' | 'ident' | 'dollar' | 'line-comment' | 'block-comment';

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

function isEscapeString(text: string, quoteIdx: number): boolean {
  const prev = text[quoteIdx - 1];
  if (prev !== 'E' && prev !== 'e') return false;
  const before = text[quoteIdx - 2];
  return before === undefined || !IDENT_CHAR.test(before);
}

/**
 * Splits SQL text into segments. Handles '...' (with '' and E'\'' escapes), "..." identifiers,
 * $$...$$ / $tag$...$tag$ dollar quotes, -- line comments and nestable block comments.
 * Segments cover the whole input without gaps.
 */
export function tokenizeSql(text: string): Segment[] {
  const segs: Segment[] = [];
  const n = text.length;
  let i = 0;
  let codeStart = 0;

  const flushCode = (upTo: number): void => {
    if (upTo > codeStart) segs.push({ kind: 'code', start: codeStart, end: upTo });
  };
  const pushSeg = (kind: SegmentKind, start: number, end: number): void => {
    flushCode(start);
    segs.push({ kind, start, end });
    i = end;
    codeStart = end;
  };

  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '-' && d === '-') {
      let j = i + 2;
      while (j < n && text[j] !== '\n') j++;
      pushSeg('line-comment', i, j);
    } else if (c === '/' && d === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      pushSeg('block-comment', i, j);
    } else if (c === "'") {
      const esc = isEscapeString(text, i);
      let j = i + 1;
      while (j < n) {
        const ch = text[j];
        if (esc && ch === '\\') {
          j += 2;
          continue;
        }
        if (ch === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      pushSeg('string', i, Math.min(j, n));
    } else if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      pushSeg('ident', i, Math.min(j, n));
    } else if (c === '$') {
      const prev = text[i - 1];
      const m = prev !== undefined && IDENT_CHAR.test(prev) ? null : DOLLAR_TAG.exec(text.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        pushSeg('dollar', i, end);
      } else i++;
    } else i++;
  }
  flushCode(n);
  return segs;
}

function blank(s: string): string {
  return s.replace(/[^\r\n]/g, ' ');
}

/** Copy of `text` with comments replaced by spaces (newlines kept). Same length as input. */
export function maskComments(text: string, segs: Segment[] = tokenizeSql(text)): string {
  let out = '';
  for (const s of segs) {
    const part = text.slice(s.start, s.end);
    out += s.kind === 'line-comment' || s.kind === 'block-comment' ? blank(part) : part;
  }
  return out;
}

/**
 * Copy of `text` with comments AND the interior of string / dollar-quoted literals blanked.
 * Quotes/tags are preserved. Quoted identifiers are kept. Same length as input.
 */
export function maskLiterals(text: string, segs: Segment[] = tokenizeSql(text)): string {
  let out = '';
  for (const s of segs) {
    const part = text.slice(s.start, s.end);
    if (s.kind === 'line-comment' || s.kind === 'block-comment') out += blank(part);
    else if (s.kind === 'string') {
      const closed = part.length >= 2 && part.endsWith("'");
      out += closed ? `'${blank(part.slice(1, -1))}'` : `'${blank(part.slice(1))}`;
    } else if (s.kind === 'dollar') {
      const tagMatch = DOLLAR_TAG.exec(part);
      const tag = tagMatch ? tagMatch[0] : '$$';
      if (part.length >= tag.length * 2 && part.endsWith(tag)) {
        out += tag + blank(part.slice(tag.length, -tag.length)) + tag;
      } else out += tag + blank(part.slice(tag.length));
    } else out += part;
  }
  return out;
}

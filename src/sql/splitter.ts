import { createLineMap } from '../utils/line-map.js';
import { maskComments, maskLiterals, tokenizeSql } from './tokenizer.js';

export interface Statement {
  /** Original text of the statement (no trailing semicolon). */
  text: string;
  /** Same length as text; comments blanked. */
  masked: string;
  /** Same length as text; comments and string/dollar literal interiors blanked. */
  code: string;
  startOffset: number;
  endOffset: number;
  /** 1-based line of the first non-comment character. */
  startLine: number;
}

export function splitStatements(sql: string): Statement[] {
  const segs = tokenizeSql(sql);
  const masked = maskComments(sql, segs);
  const code = maskLiterals(sql, segs);
  const lines = createLineMap(sql);
  const out: Statement[] = [];

  const emit = (from: number, to: number): void => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(masked[s] ?? '')) s++;
    while (e > s && /\s/.test(masked[e - 1] ?? '')) e--;
    if (s >= e) return;
    out.push({
      text: sql.slice(s, e),
      masked: masked.slice(s, e),
      code: code.slice(s, e),
      startOffset: s,
      endOffset: e,
      startLine: lines.offsetToLineCol(s).line,
    });
  };

  let stmtStart = 0;
  for (const seg of segs) {
    if (seg.kind !== 'code') continue;
    let idx = sql.indexOf(';', seg.start);
    while (idx !== -1 && idx < seg.end) {
      emit(stmtStart, idx);
      stmtStart = idx + 1;
      idx = sql.indexOf(';', idx + 1);
    }
  }
  emit(stmtStart, sql.length);
  return out;
}

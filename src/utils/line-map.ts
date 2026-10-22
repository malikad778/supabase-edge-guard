export interface LineMap {
  lineCount: number;
  /** 1-based line / column for a 0-based char offset. */
  offsetToLineCol(offset: number): { line: number; column: number };
  /** 0-based offset of the first char of a 1-based line. */
  lineStart(line: number): number;
  /** Text of a 1-based line without trailing newline / carriage return. */
  lineText(line: number): string;
}

export function createLineMap(text: string): LineMap {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  const lineStart = (line: number): number => starts[Math.min(Math.max(line, 1), starts.length) - 1] ?? 0;
  return {
    lineCount: starts.length,
    offsetToLineCol(offset: number) {
      const o = Math.max(0, Math.min(offset, text.length));
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((starts[mid] ?? 0) <= o) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, column: o - (starts[lo] ?? 0) + 1 };
    },
    lineStart,
    lineText(line: number) {
      const s = lineStart(line);
      let e = text.indexOf('\n', s);
      if (e === -1) e = text.length;
      let out = text.slice(s, e);
      if (out.endsWith('\r')) out = out.slice(0, -1);
      return out;
    },
  };
}

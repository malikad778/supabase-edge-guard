import { describe, expect, it } from 'vitest';
import { splitStatements } from '../../src/sql/splitter.js';
import { maskComments, maskLiterals, tokenizeSql } from '../../src/sql/tokenizer.js';

describe('tokenizeSql', () => {
  it('covers the whole input without gaps', () => {
    const sql = 'select \'a;b\', "x;y" -- c;\n/* d; /* nested */ e; */ $$ f; $$;';
    const segs = tokenizeSql(sql);
    expect(segs[0]?.start).toBe(0);
    expect(segs.at(-1)?.end).toBe(sql.length);
    for (let i = 1; i < segs.length; i++) expect(segs[i]?.start).toBe(segs[i - 1]?.end);
  });

  it('handles escaped quotes and E-strings', () => {
    const kinds = tokenizeSql("select 'it''s', E'a\\'b';").filter((s) => s.kind === 'string');
    expect(kinds).toHaveLength(2);
  });

  it('handles tagged dollar quotes but not $1 parameters', () => {
    const segs = tokenizeSql('select $1, $fn$ a $$ b $fn$;');
    expect(segs.filter((s) => s.kind === 'dollar')).toHaveLength(1);
  });

  it('treats unterminated constructs as running to the end', () => {
    expect(tokenizeSql("select 'oops")).toHaveLength(2);
    expect(tokenizeSql('select /* never closed')).toHaveLength(2);
  });
});

describe('masking', () => {
  it('maskComments preserves length and newlines', () => {
    const sql = 'a -- x\nb /* y\nz */ c';
    const m = maskComments(sql);
    expect(m).toHaveLength(sql.length);
    expect(m.split('\n')).toHaveLength(3);
    expect(m).not.toContain('x');
    expect(m).toContain('c');
  });

  it('maskLiterals blanks string and dollar interiors', () => {
    const sql = "select auth.uid() = 'auth.uid()' and $$ auth.uid() $$";
    const m = maskLiterals(sql);
    expect(m).toHaveLength(sql.length);
    expect(m.match(/auth\.uid\(\)/g)).toHaveLength(1);
  });
});

describe('splitStatements', () => {
  it('ignores semicolons in strings, comments and dollar bodies', () => {
    const sql = `-- header; not a split
select 'a;b';
create function f() returns int language sql as $$ select 1; select 2; $$;
/* x; */ select 3;`;
    const s = splitStatements(sql);
    expect(s).toHaveLength(3);
    expect(s[1]?.text).toContain('select 2;');
  });

  it('reports the line of the first code character', () => {
    const s = splitStatements('\n-- c\n\ncreate table t (id int);\n  select 1');
    expect(s.map((x) => x.startLine)).toEqual([4, 5]);
  });

  it('works with CRLF', () => {
    const s = splitStatements('select 1;\r\nselect 2;\r\n');
    expect(s.map((x) => x.startLine)).toEqual([1, 2]);
  });

  it('skips empty statements', () => {
    expect(splitStatements(';;; -- only comment\n')).toHaveLength(0);
  });
});

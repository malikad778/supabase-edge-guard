/** Minimal JSON-Schema (draft-04 subset) validator - enough for the official SARIF 2.1.0 schema. */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = { [k: string]: Json };

function isObj(v: unknown): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

export function validate(root: Schema, schema: Schema, value: unknown, at = '$'): string[] {
  const errors: string[] = [];
  const ref = schema.$ref;
  if (typeof ref === 'string') {
    const target = ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((acc, k) => (isObj(acc) ? acc[k] : undefined), root);
    if (!isObj(target)) return [`${at}: unresolved $ref ${ref}`];
    return validate(root, target, value, at);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => matchesType(value, t)))
      errors.push(`${at}: expected ${types.join('|')}, got ${typeOf(value)}`);
  }
  if (
    schema.enum !== undefined &&
    !(schema.enum as Json[]).some((e) => JSON.stringify(e) === JSON.stringify(value))
  ) {
    errors.push(`${at}: not in enum`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at}: above maximum`);
  }
  if (
    typeof value === 'string' &&
    typeof schema.pattern === 'string' &&
    !new RegExp(schema.pattern).test(value)
  ) {
    errors.push(`${at}: does not match pattern ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${at}: too few items`);
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length)
      errors.push(`${at}: items not unique`);
    if (isObj(schema.items))
      value.forEach((v, i) => errors.push(...validate(root, schema.items as Schema, v, `${at}[${i}]`)));
  }
  if (isObj(value)) {
    for (const req of (schema.required as string[] | undefined) ?? [])
      if (!(req in value)) errors.push(`${at}: missing required "${req}"`);
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errors.push(...validate(root, props[k] as Schema, v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property "${k}"`);
      else if (isObj(schema.additionalProperties))
        errors.push(...validate(root, schema.additionalProperties, v, `${at}.${k}`));
    }
  }
  if (Array.isArray(schema.anyOf)) {
    if (!(schema.anyOf as Schema[]).some((s) => validate(root, s, value, at).length === 0))
      errors.push(`${at}: matches none of anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    const n = (schema.oneOf as Schema[]).filter((s) => validate(root, s, value, at).length === 0).length;
    if (n !== 1) errors.push(`${at}: matches ${n} of oneOf`);
  }
  return errors;
}

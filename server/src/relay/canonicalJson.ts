/**
 * RFC 8785 (JSON Canonicalization Scheme) subset for plain JSON data.
 *
 * Object members are sorted by UTF-16 code units (the default JS string
 * sort), scalars use ECMAScript JSON.stringify serialization, and no
 * insignificant whitespace is emitted. This matches RFC 8785 for any
 * value that round-trips through JSON.parse. Non-finite numbers and
 * non-JSON values are rejected.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('cannot canonicalize a non-finite number');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`cannot canonicalize a value of type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const members: string[] = [];
  for (const key of keys) {
    const member = record[key];
    // Match JSON.stringify: object members with undefined values are omitted
    if (member === undefined) continue;
    members.push(`${JSON.stringify(key)}:${canonicalizeJson(member)}`);
  }
  return `{${members.join(',')}}`;
}

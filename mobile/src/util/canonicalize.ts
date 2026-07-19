/**
 * RFC 8785 (JSON Canonicalization Scheme) serializer.
 *
 * Produces a deterministic JSON string: object keys sorted by UTF-16 code
 * units, no whitespace, and ES-standard number/string serialization (which is
 * exactly what JCS specifies, so JSON.stringify on primitives is compliant).
 * Used to build the byte string that card signatures are computed over, so the
 * server can verify with any JCS implementation.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) {
    throw new Error('Cannot canonicalize undefined');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // JSON.stringify semantics: undefined array elements serialize as null.
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Default sort compares UTF-16 code units, as RFC 8785 requires.
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const members = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
    return `{${members.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

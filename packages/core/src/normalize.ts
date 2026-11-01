/**
 * Clean up structured output from the model before validating it.
 *
 * Models sometimes send nested lists or objects inside tool arguments as JSON-encoded
 * strings (`"days": "[{...}]"`) and use `null` for fields they leave empty. This:
 *  - parses strings that are themselves JSON arrays or objects, recursively;
 *  - drops `null` values from objects, so schema defaults apply.
 * Everything else passes through unchanged; validation still decides what's acceptable.
 */
export function normalizeModelOutput(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        return normalizeModelOutput(JSON.parse(s), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeModelOutput(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = normalizeModelOutput(v, depth + 1);
    }
    return out;
  }
  return value;
}

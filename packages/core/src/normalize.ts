/**
 * Clean up structured output from the model before validating it.
 *
 * Models sometimes send nested lists or objects inside tool arguments as JSON-encoded
 * strings (`"stops": "[{...}]"`), occasionally with small JSON mistakes (raw newlines inside
 * strings, trailing commas) or cut off at the end. They also use `null` for fields they leave
 * empty. This:
 *  - parses strings that are themselves JSON arrays or objects, recursively, repairing small
 *    mistakes and closing a cut-off list after its last complete item;
 *  - drops `null` values from objects, so schema defaults apply.
 * Everything else passes through unchanged; validation still decides what's acceptable.
 */
export function normalizeModelOutput(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      const parsed = parseLooseJson(s);
      if (parsed !== undefined && typeof parsed === "object") return normalizeModelOutput(parsed, depth + 1);
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

/**
 * JSON.parse that tolerates the mistakes models make: raw control characters inside strings,
 * trailing commas, and output cut off part-way (keeps every complete item). Returns undefined
 * when nothing usable can be recovered.
 */
export function parseLooseJson(input: string): unknown | undefined {
  const s = input.trim();
  try {
    return JSON.parse(s);
  } catch {
    /* try repairs */
  }
  const fixed = removeTrailingCommas(escapeControlChars(s));
  try {
    return JSON.parse(fixed);
  } catch {
    /* maybe cut off */
  }
  const closed = closeTruncated(fixed);
  if (closed) {
    try {
      return JSON.parse(closed);
    } catch {
      /* give up */
    }
  }
  return undefined;
}

/** Escape raw newlines, carriage returns and tabs that appear inside JSON strings. */
function escapeControlChars(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') inString = false;
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** Remove commas directly before a closing bracket or brace (outside strings). */
function removeTrailingCommas(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      if (s[j] === "]" || s[j] === "}") continue;
    }
    out += ch;
  }
  return out;
}

/**
 * For output that was cut off: keep everything up to the last point where a complete value
 * finished inside the outermost container, then close the open brackets.
 */
function closeTruncated(s: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let best: { end: number; stack: string[] } | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") stack.push(ch);
    else if (ch === "]" || ch === "}") {
      stack.pop();
      // A value just completed. Remember it if we're still inside the outermost container.
      if (stack.length >= 1) best = { end: i, stack: [...stack] };
    }
  }
  if (!best) return null;
  const closers = best.stack
    .slice()
    .reverse()
    .map((c) => (c === "[" ? "]" : "}"))
    .join("");
  return s.slice(0, best.end + 1) + closers;
}

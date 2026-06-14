export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function decodeJsonText(value: string): unknown {
  if (value.trim().length === 0) return null;

  const parsed = parseJson(value);
  return parsed === undefined ? value : parsed;
}

export function encodeJsonText(value: unknown): string {
  if (typeof value === 'string') return value;

  const encoded = JSON.stringify(value);
  return encoded ?? '';
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '[Circular or Non-serializable]';
  }
}

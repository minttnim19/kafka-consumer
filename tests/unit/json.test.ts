import { describe, expect, it } from 'vitest';

import { decodeJsonText, encodeJsonText, parseJson, stringifyUnknown } from '@/shared/json';

describe('shared json helpers', () => {
  it('parses valid JSON and returns undefined for invalid JSON', () => {
    expect(parseJson('{"orderId":"order-001"}')).toEqual({ orderId: 'order-001' });
    expect(parseJson('plain message')).toBeUndefined();
  });

  it('decodes JSON text while preserving plain text message payloads', () => {
    expect(decodeJsonText('{"amount":100}')).toEqual({ amount: 100 });
    expect(decodeJsonText('plain message')).toBe('plain message');
    expect(decodeJsonText('   ')).toBeNull();
  });

  it('encodes message payloads without changing plain strings', () => {
    expect(encodeJsonText('plain message')).toBe('plain message');
    expect(encodeJsonText({ amount: 100 })).toBe('{"amount":100}');
    expect(encodeJsonText(undefined)).toBe('');
  });

  it('stringifies unknown values for logger payload fields', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(stringifyUnknown('plain message')).toBe('plain message');
    expect(stringifyUnknown(null)).toBe('');
    expect(stringifyUnknown({ amount: 100 })).toBe('{"amount":100}');
    expect(stringifyUnknown(circular)).toBe('[Circular or Non-serializable]');
  });
});

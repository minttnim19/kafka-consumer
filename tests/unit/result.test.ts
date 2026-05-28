import { describe, expect, it } from 'vitest';
import { failure, success } from '@/shared/result';

describe('Result', () => {
  it('creates a success result', () => {
    expect(success('ok')).toEqual({ ok: true, value: 'ok' });
  });

  it('creates a failure result', () => {
    const error = new Error('failed');

    expect(failure(error)).toEqual({ ok: false, error });
  });
});

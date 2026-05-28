import { afterEach, describe, expect, it } from 'vitest';

import { resolveStepName, STEP_NAME_RULES } from '@/infra/logger/step-name-map';

describe('resolveStepName', () => {
  afterEach(() => {
    STEP_NAME_RULES.splice(0, STEP_NAME_RULES.length);
  });

  it('returns activity name when no mapping rule exists', () => {
    expect(resolveStepName('consume-kafka-message', '/orders/create', 'POST')).toBe(
      'consume-kafka-message',
    );
  });

  it('returns activity name when endpoint is undefined', () => {
    expect(resolveStepName('consume-kafka-message')).toBe('consume-kafka-message');
  });

  it('matches exact endpoint rules with normalized URL paths', () => {
    STEP_NAME_RULES.push({
      type: 'exact',
      endpoint: '/orders/create',
      method: 'POST',
      step_name: 'CREATE_ORDER',
    });

    expect(
      resolveStepName('consume-kafka-message', 'https://api.test/orders/create?id=1', 'POST'),
    ).toBe('CREATE_ORDER');
  });

  it('falls back to activity name when method does not match', () => {
    STEP_NAME_RULES.push({
      type: 'exact',
      endpoint: '/orders/create',
      method: 'POST',
      step_name: 'CREATE_ORDER',
    });

    expect(resolveStepName('consume-kafka-message', '/orders/create', 'GET')).toBe(
      'consume-kafka-message',
    );
  });

  it('matches regex rules and falls back when step name is empty', () => {
    STEP_NAME_RULES.push({
      type: 'regex',
      pattern: /^\/orders\/\d+\/pay$/u,
      method: 'POST',
      step_name: '',
    });

    expect(resolveStepName('pay-order', '/orders/123/pay', 'POST')).toBe('pay-order');
  });

  it('normalizes endpoints without a leading slash', () => {
    STEP_NAME_RULES.push({
      type: 'exact',
      endpoint: '/orders/create',
      step_name: 'CREATE_ORDER',
    });

    expect(resolveStepName('consume-kafka-message', 'orders/create')).toBe('CREATE_ORDER');
  });

  it('falls back for empty endpoints', () => {
    STEP_NAME_RULES.push({
      type: 'exact',
      endpoint: '/',
      step_name: 'ROOT',
    });

    expect(resolveStepName('consume-kafka-message', '')).toBe('consume-kafka-message');
  });
});

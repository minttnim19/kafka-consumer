export type StepNameRule =
  | { type: 'exact'; endpoint: string; method?: string; step_name: string }
  | { type: 'regex'; pattern: RegExp; method?: string; step_name: string };

export const STEP_NAME_RULES: StepNameRule[] = [
  // { type: 'exact', endpoint: '/orders/create', method: 'POST', step_name: 'CREATE_ORDER' },
  // { type: 'exact', endpoint: '/orders/cancel', method: 'POST', step_name: 'CANCEL_ORDER' },
  // { type: 'regex', pattern: /^\/orders\/\d+\/pay$/, method: 'POST', step_name: 'PAY_ORDER' },
];

const normalizeEndpoint = (value: string): string => {
  if (!value) return value;

  let endpointPath: string;
  try {
    endpointPath = new URL(value).pathname;
  } catch {
    endpointPath = value;
  }

  const [withoutQuery = ''] = endpointPath.split('?');
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
};

const matchesRule = (rule: StepNameRule, endpoint: string, method?: string): boolean => {
  if (method && rule.method && rule.method !== method) return false;

  return rule.type === 'exact' ? rule.endpoint === endpoint : rule.pattern.test(endpoint);
};

const stepNameOrActivity = (stepName: string | undefined, activity: string): string => {
  if (stepName === undefined) return activity;
  if (stepName.length === 0) return activity;
  return stepName;
};

export const resolveStepName = (activity: string, endpoint?: string, method?: string): string => {
  if (endpoint === undefined || STEP_NAME_RULES.length === 0) return activity;

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  const rule = STEP_NAME_RULES.find((item) => matchesRule(item, normalizedEndpoint, method));

  return stepNameOrActivity(rule?.step_name, activity);
};

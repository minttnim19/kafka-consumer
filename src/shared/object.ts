export type UnknownRecord = Record<string, unknown>;

export const toRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;

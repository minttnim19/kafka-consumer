export type ManualKafkaMessage = {
  topic: string;
  key?: string;
  value: string;
  headers: Record<string, string>;
};

export type ManualMessagePublisher = {
  publish: (message: ManualKafkaMessage) => Promise<void>;
};

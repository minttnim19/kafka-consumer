export type ConsumedMessageInput = {
  txid: string;
  topic: string;
  partition: number;
  offset: string;
  key?: string;
  value: string;
  receivedAt: string;
};

export type MessageProcessResult = {
  txid: string;
  status: 'processed' | 'failed';
  processedAt: string;
};

export type MessageProcessor = {
  execute: (input: ConsumedMessageInput) => MessageProcessResult | Promise<MessageProcessResult>;
};

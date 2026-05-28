import { createApp } from '@/bootstrap/app';

async function main(): Promise<void> {
  const app = createApp();
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      await app.stop();
      process.exit(0);
    } catch (error) {
      console.error(`Failed to shutdown after ${signal}`, error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

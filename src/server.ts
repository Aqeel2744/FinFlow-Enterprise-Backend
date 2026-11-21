import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';

const server = app.listen(env.PORT, () => {
  console.log(`
FinFlow Financial Management Engine running on port ${env.PORT}
Environment: ${env.NODE_ENV}
API Endpoint: http://localhost:${env.PORT}/api/v1
Health Check: http://localhost:${env.PORT}/health
  `);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Commencing graceful server shutdown...`);

  server.close(async () => {
    console.log('HTTP server closed.');

    try {
      await prisma.$disconnect();
      console.log('PostgreSQL database connection cleanly disconnected.');
    } catch (err: any) {
      console.error('Error disconnecting database:', err.message);
    }

    if (redis) {
      try {
        await redis.quit();
        console.log('Redis client cleanly disconnected.');
      } catch (err: any) {
        console.error('Error disconnecting Redis:', err.message);
      }
    }

    process.exit(0);
  });

  // Force exit if hanging
  setTimeout(() => {
    console.error('Forceful termination after shutdown timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

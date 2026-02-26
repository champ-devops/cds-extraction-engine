/**
 * CDS Automated Minutes Service
 *
 * Main entry point for the queue worker runtime and monitoring endpoints.
 */

import Fastify from 'fastify';
import { initializeConfig, getConfig } from './config/appConfig.js';
import { getJobQueueStatus, initializeJobQueueRuntime, shutdownJobQueueRuntime } from './queue/jobQueueRuntime.js';
import { lookupV2CustomerIDByV1CustomerID } from './services/customerApiData.js';

async function main() {
  await initializeConfig();
  const config = getConfig();

  const fastify = Fastify({
    logger: {
      level: config.logger?.level || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    }
  });

  await initializeJobQueueRuntime();

  fastify.get('/health', async (_, reply) => {
    const queueStatus = getJobQueueStatus();
    if (!queueStatus.isReady) {
      return reply.status(503).send({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        service: 'cds-automated-minutes',
        queue: {
          isReady: false
        }
      });
    }

    return reply.status(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'cds-automated-minutes',
      queue: {
        isReady: true,
        workerID: queueStatus.workerID
      }
    });
  });

  fastify.get('/status', async () => {
    const queueStatus = getJobQueueStatus();
    return {
      status: queueStatus.isReady ? 'running' : 'starting',
      timestamp: new Date().toISOString(),
      uptimeSecs: Math.floor(process.uptime()),
      queue: queueStatus
    };
  });

  fastify.get('/customerapi/lookup/v1-customer/:v1CustomerID', async (request, reply) => {
    const { v1CustomerID } = request.params;
    const parsedV1CustomerID = Number(v1CustomerID);
    if (!Number.isInteger(parsedV1CustomerID) || parsedV1CustomerID <= 0) {
      return reply.status(400).send({
        success: false,
        error: 'v1CustomerID must be a positive integer'
      });
    }

    try {
      const result = await lookupV2CustomerIDByV1CustomerID(parsedV1CustomerID);
      return reply.status(200).send({
        success: true,
        v1CustomerID: result.v1CustomerID,
        customerID: result.v2CustomerID,
        customerNameInternal: result.customerNameInternal,
        customerAccessID: result.customerAccessID,
        customerName: result.customerName
      });
    } catch (error) {
      const statusCode = String(error.message || '').includes('Unable to find CoreAPI customer') ? 404 : 502;
      return reply.status(statusCode).send({
        success: false,
        error: error.message
      });
    }
  });

  fastify.setErrorHandler((error, _, reply) => {
    fastify.log.error(error);
    return reply.status(error.statusCode || 500).send({
      error: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred'
    });
  });

  const host = config.server?.host || '0.0.0.0';
  const port = config.server?.port || 7002;

  try {
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on http://${host}:${port}`);
    fastify.log.info('Available endpoints: GET /health, GET /status, GET /customerapi/lookup/v1-customer/:v1CustomerID');
  } catch (err) {
    fastify.log.error(err);
    await shutdownJobQueueRuntime();
    process.exit(1);
  }

  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await shutdownJobQueueRuntime();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

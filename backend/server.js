require('dotenv').config();
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const { app, logger } = require('./app');
const config = require('./src/config');
const { pool } = require('./src/models/db');
const { scheduleRecurringJobs } = require('./src/services/queue');

// ─── HTTP + Socket.IO Server ──────────────────────────────────────────────────
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: config.cors.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Socket.IO Auth Middleware ────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    socket.userId = decoded.userId;
    socket.tenantId = decoded.tenantId;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
});

// ─── Socket.IO Connection Handling ────────────────────────────────────────────
io.on('connection', (socket) => {
  const { userId, tenantId } = socket;
  logger.info(`[Socket.IO] Client connected: user=${userId} tenant=${tenantId}`);

  // Join tenant room for broadcast
  socket.join(`tenant:${tenantId}`);
  socket.join(`user:${userId}`);

  // Subscribe to job updates
  socket.on('subscribe:job', ({ jobId }) => {
    socket.join(`job:${jobId}`);
    logger.debug(`[Socket.IO] ${userId} subscribed to job ${jobId}`);
  });

  socket.on('unsubscribe:job', ({ jobId }) => {
    socket.leave(`job:${jobId}`);
  });

  socket.on('disconnect', (reason) => {
    logger.debug(`[Socket.IO] Client disconnected: ${userId}, reason: ${reason}`);
  });

  socket.on('error', (err) => {
    logger.error(`[Socket.IO] Socket error for user ${userId}:`, err.message);
  });
});

// ─── Attach io to app for use in routes ───────────────────────────────────────
app.set('io', io);

// ─── Real-time notification helpers ──────────────────────────────────────────
const notifyTenant = (tenantId, event, data) => {
  io.to(`tenant:${tenantId}`).emit(event, data);
};

const notifyUser = (userId, event, data) => {
  io.to(`user:${userId}`).emit(event, data);
};

const notifyJob = (jobId, event, data) => {
  io.to(`job:${jobId}`).emit(event, data);
};

// Export notification helpers for use in services
app.set('notifyTenant', notifyTenant);
app.set('notifyUser', notifyUser);
app.set('notifyJob', notifyJob);

// ─── Queue Event Listeners for Real-time Updates ─────────────────────────────
const { videoQueue, analyticsQueue, trendQueue } = require('./src/services/queue');

videoQueue.on('completed', (job, result) => {
  if (result?.tenantId) {
    notifyTenant(result.tenantId, 'video:completed', {
      jobId: job.id,
      generationId: result.generationId,
      assetUrl: result.assetUrl,
    });
  }
  notifyJob(job.id, 'job:completed', result);
});

videoQueue.on('failed', (job, err) => {
  notifyJob(job.id, 'job:failed', { error: err.message });
});

videoQueue.on('progress', (job, progress) => {
  notifyJob(job.id, 'job:progress', { progress });
});

analyticsQueue.on('completed', (job, result) => {
  if (result?.tenantId) {
    notifyTenant(result.tenantId, 'analytics:synced', {
      accountId: result.accountId,
      platform: result.platform,
      insightsSynced: result.insightsSynced,
    });
  }
});

trendQueue.on('completed', (job, result) => {
  if (result?.tenantId) {
    notifyTenant(result.tenantId, 'trends:updated', {
      reportId: result.reportId,
    });
  }
});

// ─── Database Health Check ────────────────────────────────────────────────────
const checkDatabaseConnection = async () => {
  try {
    await pool.query('SELECT 1');
    logger.info('[Server] Database connection verified');
    return true;
  } catch (err) {
    logger.error('[Server] Database connection failed:', err.message);
    return false;
  }
};

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  logger.info(`[Server] Received ${signal}, starting graceful shutdown...`);

  server.close(async () => {
    logger.info('[Server] HTTP server closed');

    try {
      await pool.end();
      logger.info('[Server] Database pool closed');
    } catch (err) {
      logger.error('[Server] Error closing DB pool:', err.message);
    }

    try {
      await videoQueue.close();
      await analyticsQueue.close();
      await trendQueue.close();
      logger.info('[Server] Queues closed');
    } catch (err) {
      logger.error('[Server] Error closing queues:', err.message);
    }

    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('[Server] Force shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Server] Unhandled Rejection:', { reason, promise });
});

process.on('uncaughtException', (err) => {
  logger.error('[Server] Uncaught Exception:', err);
  process.exit(1);
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
  const dbConnected = await checkDatabaseConnection();

  if (!dbConnected && config.env === 'production') {
    logger.error('[Server] Cannot start without database connection in production');
    process.exit(1);
  }

  // Schedule recurring background jobs
  try {
    await scheduleRecurringJobs();
  } catch (err) {
    logger.warn('[Server] Failed to schedule recurring jobs (Redis may be unavailable):', err.message);
  }

  server.listen(config.port, () => {
    logger.info(`[Server] Digital Marketing AI Platform running on port ${config.port}`);
    logger.info(`[Server] Environment: ${config.env}`);
    logger.info(`[Server] Socket.IO enabled for real-time updates`);
    if (!dbConnected) {
      logger.warn('[Server] Running without database connection - some features unavailable');
    }
  });
};

startServer();

module.exports = { server, io, notifyTenant, notifyUser, notifyJob };

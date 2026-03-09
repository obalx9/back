import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger.js';
import pool from './utils/db.js';
import coursesRouter from './routes/courses.js';
import postsRouter from './routes/posts.js';
import mediaRouter from './routes/media.js';
import adminRouter from './routes/admin.js';
import adsRouter from './routes/ads.js';
import featuredRouter from './routes/featured.js';
import statsRouter from './routes/stats.js';
import authRouter from './routes/auth.js';
import telegramRouter from './routes/telegram.js';
import oauthRouter from './routes/oauth.js';
import sellersRouter from './routes/sellers.js';
import enrollmentsRouter from './routes/enrollments.js';
import contactsRouter from './routes/contacts.js';
import metricsRouter from './routes/metrics.js';
import scriptsRouter from './routes/scripts.js';
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

let dbReady = false;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: dbReady ? 'connected' : 'connecting', timestamp: new Date().toISOString() });
});

// Public routes (no auth required)
app.use('/api/auth', authRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/telegram', telegramRouter);

// Contacts and metrics: GET is public, write requires super_admin
app.use('/api/contacts', (req, res, next) => {
  if (req.method === 'GET') return next();
  return authMiddleware(req as any, res, next);
}, contactsRouter);

app.use('/api/metrics', (req, res, next) => {
  if (req.method === 'GET') return next();
  return authMiddleware(req as any, res, next);
}, metricsRouter);

app.use('/api/scripts', (req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/all')) return next();
  return authMiddleware(req as any, res, next);
}, scriptsRouter);

// Mixed routes: GET is public, write operations require auth
app.use('/api/ads', (req, res, next) => {
  if (req.method === 'GET') return next();
  return authMiddleware(req as any, res, next);
}, adsRouter);

app.use('/api/featured', (req, res, next) => {
  if (req.method === 'GET') return next();
  return authMiddleware(req as any, res, next);
}, featuredRouter);

// Media routes: GET uses optional auth (for img src), write operations require full auth
app.use('/api/media', (req, res, next) => {
  if (req.method === 'GET') return optionalAuthMiddleware(req as any, res, next);
  return authMiddleware(req as any, res, next);
}, mediaRouter);
app.use('/media', (req, res, next) => {
  if (req.method === 'GET') return optionalAuthMiddleware(req as any, res, next);
  return authMiddleware(req as any, res, next);
}, mediaRouter);

// Protected routes (auth required)
app.use('/api/courses', authMiddleware, coursesRouter);
app.use('/api/posts', authMiddleware, postsRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/stats', authMiddleware, statsRouter);
app.use('/api/sellers', authMiddleware, sellersRouter);
app.use('/api/enrollments', authMiddleware, enrollmentsRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

async function connectWithRetry(retries = 10, delayMs = 3000): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      logger.info('Database connection verified');
      dbReady = true;
      return;
    } catch (err) {
      logger.error(`DB connection attempt ${i}/${retries} failed:`, err);
      if (i === retries) {
        logger.error('All DB connection attempts exhausted. Exiting.');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function start() {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  await connectWithRetry();
}

start();

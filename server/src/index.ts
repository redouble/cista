import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDb, saveDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { keysRouter } from './routes/keys.js';
import { filesRouter } from './routes/files.js';
import { sharesRouter } from './routes/shares.js';
import { adminRouter } from './routes/admin.js';
import { pagesRouter } from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: config.nodeEnv === 'production' ? false : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// View engine
app.set('view engine', 'ejs');
app.set('views', config.paths.views);
app.set('view options', { root: config.paths.views });

// Static files
const publicDir = config.paths.public;
app.use('/static', express.static(publicDir));

// API rate limiting
app.use('/api', apiLimiter);

// API routes
app.use('/api/auth', authRouter);
app.use('/api/keys', keysRouter);
app.use('/api/files', filesRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/admin', adminRouter);

// Page routes
app.use('/', pagesRouter);

// Error handling
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start
async function start() {
  try {
    await runMigrations();
    app.listen(config.port, config.host, () => {
      console.log(`🔒 Cista (密匣) server running at http://${config.host}:${config.port}`);
      console.log(`   Environment: ${config.nodeEnv}`);
      console.log(`   Database: ${config.database.url}`);
      console.log(`   Storage: ${config.storage.type} (${config.storage.localPath})`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  saveDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  saveDb();
  process.exit(0);
});

start();

export default app;

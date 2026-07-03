import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  database: {
    url: process.env.DATABASE_URL || path.join(__dirname, '..', 'data', 'cista.db'),
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'cista-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // File storage
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || path.join(__dirname, '..', 'data', 'files'),
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '1073741824', 10), // 1GB default
  },

  // Share code
  shareCode: {
    length: parseInt(process.env.SHARE_CODE_LENGTH || '8', 10),
    defaultExpiryDays: parseInt(process.env.SHARE_CODE_EXPIRY_DAYS || '7', 10),
    defaultMaxDownloads: parseInt(process.env.SHARE_CODE_MAX_DOWNLOADS || '5', 10),
  },

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // max requests per window
  },

  // Password
  password: {
    minLength: 8,
    bcryptRounds: 10,
    pbkdf2Iterations: 600000,
  },

  // Paths
  paths: {
    views: path.join(__dirname, 'views'),
    public: path.join(__dirname, '..', 'public'),
    data: path.join(__dirname, '..', 'data'),
  },
};

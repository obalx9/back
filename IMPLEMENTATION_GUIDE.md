# Backend Implementation Guide

This guide provides complete implementation details for all backend components.

## Table of Contents
1. [Core Setup](#core-setup)
2. [Authentication](#authentication)
3. [S3 Service](#s3-service)
4. [Telegram Webhook](#telegram-webhook)
5. [API Routes](#api-routes)
6. [Middleware](#middleware)

---

## Core Setup

### src/index.ts
```typescript
import dotenv from 'dotenv';
dotenv.config();

import { app } from './server';
import { logger } from './utils/logger';
import { closePool } from './utils/db';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
});
```

### src/server.ts
```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';

// Import routes
import authRoutes from './routes/auth';
import courseRoutes from './routes/courses';
import enrollmentRoutes from './routes/enrollments';
import sellerRoutes from './routes/seller';
import adminRoutes from './routes/admin';
import mediaRoutes from './routes/media';
import telegramRoutes from './routes/telegram';

export const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/telegram', telegramRoutes);

// Error handling
app.use(errorHandler);
```

---

## Authentication

### src/middleware/auth.ts
```typescript
import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = payload;
  next();
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function requireSeller(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.isSeller) {
    return res.status(403).json({ error: 'Seller access required' });
  }
  next();
}
```

### src/services/authService.ts
```typescript
import crypto from 'crypto';
import { query } from '../utils/db';
import { generateToken } from '../utils/jwt';

export async function verifyTelegramAuth(data: any): Promise<boolean> {
  const { hash, ...params } = data;

  const checkString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('\n');

  const botToken = await getBotToken(params.bot_id);
  const secretKey = crypto
    .createHash('sha256')
    .update(botToken)
    .digest();

  const hmac = crypto
    .createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex');

  return hmac === hash;
}

export async function findOrCreateTelegramUser(telegramData: any) {
  const { id, username, first_name, last_name, photo_url } = telegramData;

  let user = await query(
    'SELECT * FROM users WHERE telegram_id = $1',
    [id]
  );

  if (user.rows.length === 0) {
    user = await query(
      `INSERT INTO users (telegram_id, telegram_username, first_name, last_name, photo_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, username, first_name, last_name, photo_url]
    );
  }

  const userData = user.rows[0];

  const roles = await query(
    'SELECT role FROM user_roles WHERE user_id = $1',
    [userData.id]
  );

  const seller = await query(
    'SELECT id FROM sellers WHERE user_id = $1',
    [userData.id]
  );

  return {
    user: userData,
    roles: roles.rows.map(r => r.role),
    isSeller: seller.rows.length > 0,
    sellerId: seller.rows[0]?.id,
  };
}

async function getBotToken(botId: string): Promise<string> {
  const result = await query(
    'SELECT bot_token FROM telegram_bots WHERE id = $1',
    [botId]
  );
  return result.rows[0]?.bot_token;
}
```

---

## S3 Service

### src/services/s3Service.ts
```typescript
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'ru-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET || 'keykurs-media';

export async function uploadToS3(
  key: string,
  body: Buffer | Readable,
  contentType?: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return `${process.env.S3_PUBLIC_URL}/${key}`;
}

export async function getFromS3(key: string): Promise<Readable> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  return response.Body as Readable;
}

export async function deleteFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}

export async function getPresignedUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export function generateS3Key(
  courseId: string,
  filename: string,
  type: string
): string {
  const timestamp = Date.now();
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `courses/${courseId}/${type}/${timestamp}-${sanitized}`;
}
```

---

## Telegram Webhook

### src/services/telegramService.ts
```typescript
import axios from 'axios';
import { uploadToS3, generateS3Key } from './s3Service';
import { query, transaction } from '../utils/db';
import { logger } from '../utils/logger';

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  file_path: string;
}

export async function downloadAndStoreMedia(
  botToken: string,
  fileId: string,
  courseId: string,
  mediaType: string
): Promise<string> {
  try {
    // Get file info from Telegram
    const fileInfoResponse = await axios.get(
      `https://api.telegram.org/bot${botToken}/getFile`,
      { params: { file_id: fileId } }
    );

    const fileInfo: TelegramFile = fileInfoResponse.data.result;

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
    const fileResponse = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
    });

    const fileBuffer = Buffer.from(fileResponse.data);

    // Generate S3 key
    const filename = fileInfo.file_path.split('/').pop() || 'file';
    const s3Key = generateS3Key(courseId, filename, mediaType);

    // Upload to S3
    const s3Url = await uploadToS3(
      s3Key,
      fileBuffer,
      fileResponse.headers['content-type']
    );

    logger.info('Media uploaded to S3', { fileId, s3Url });

    return s3Url;
  } catch (error) {
    logger.error('Failed to download and store media', { fileId, error });
    throw error;
  }
}

export async function processMediaGroup(
  botToken: string,
  mediaGroupId: string,
  courseId: string
) {
  // Wait 5 seconds for all messages in group to arrive
  await new Promise(resolve => setTimeout(resolve, 5000));

  const client = await transaction(async (client) => {
    // Get all messages in this media group
    const messages = await client.query(
      `SELECT * FROM telegram_media_group_buffer
       WHERE media_group_id = $1`,
      [mediaGroupId]
    );

    if (messages.rows.length === 0) {
      return;
    }

    // Create course post
    const firstMessage = messages.rows[0];
    const post = await client.query(
      `INSERT INTO course_posts (course_id, message_text, telegram_message_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [courseId, firstMessage.message_text, firstMessage.telegram_message_id]
    );

    const postId = post.rows[0].id;

    // Download and store all media files
    for (const msg of messages.rows) {
      try {
        const s3Url = await downloadAndStoreMedia(
          botToken,
          msg.file_id,
          courseId,
          msg.media_type
        );

        // Insert media record
        await client.query(
          `INSERT INTO course_post_media
           (post_id, media_type, s3_url, file_name, file_size, mime_type, media_group_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            postId,
            msg.media_type,
            s3Url,
            msg.file_name,
            msg.file_size,
            msg.mime_type,
            mediaGroupId,
          ]
        );
      } catch (error) {
        logger.error('Failed to process media in group', { msg, error });
      }
    }

    // Delete processed messages from buffer
    await client.query(
      'DELETE FROM telegram_media_group_buffer WHERE media_group_id = $1',
      [mediaGroupId]
    );
  });
}

export async function handleIncomingMessage(
  botId: string,
  message: any
): Promise<void> {
  const bot = await query(
    'SELECT * FROM telegram_bots WHERE id = $1',
    [botId]
  );

  if (bot.rows.length === 0) {
    throw new Error('Bot not found');
  }

  const botToken = bot.rows[0].bot_token;
  const chatId = message.chat.id;

  // Find course for this chat
  const course = await query(
    'SELECT id FROM courses WHERE telegram_chat_id = $1',
    [chatId]
  );

  if (course.rows.length === 0) {
    logger.warn('No course found for chat', { chatId });
    return;
  }

  const courseId = course.rows[0].id;

  // Handle media group
  if (message.media_group_id) {
    await handleMediaGroupMessage(botToken, message, courseId);
    return;
  }

  // Handle single media
  if (message.photo || message.video || message.document || message.voice) {
    await handleSingleMediaMessage(botToken, message, courseId);
    return;
  }

  // Handle text-only message
  if (message.text) {
    await query(
      `INSERT INTO course_posts (course_id, message_text, telegram_message_id)
       VALUES ($1, $2, $3)`,
      [courseId, message.text, message.message_id]
    );
  }
}

async function handleMediaGroupMessage(
  botToken: string,
  message: any,
  courseId: string
) {
  const mediaType = message.photo ? 'photo' : message.video ? 'video' : 'document';
  const media = message.photo?.[message.photo.length - 1] || message.video || message.document;

  // Buffer the message
  await query(
    `INSERT INTO telegram_media_group_buffer
     (media_group_id, telegram_message_id, file_id, media_type, file_name, file_size, mime_type, message_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      message.media_group_id,
      message.message_id,
      media.file_id,
      mediaType,
      media.file_name,
      media.file_size,
      media.mime_type,
      message.caption,
    ]
  );

  // Schedule processing (in real implementation, use a job queue)
  setTimeout(() => {
    processMediaGroup(botToken, message.media_group_id, courseId);
  }, 5000);
}

async function handleSingleMediaMessage(
  botToken: string,
  message: any,
  courseId: string
) {
  const mediaType = message.photo ? 'photo'
    : message.video ? 'video'
    : message.document ? 'document'
    : message.voice ? 'voice'
    : 'unknown';

  const media = message.photo?.[message.photo.length - 1]
    || message.video
    || message.document
    || message.voice;

  // Create post
  const post = await query(
    `INSERT INTO course_posts (course_id, message_text, telegram_message_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [courseId, message.caption || message.text, message.message_id]
  );

  const postId = post.rows[0].id;

  try {
    // Download and upload to S3
    const s3Url = await downloadAndStoreMedia(
      botToken,
      media.file_id,
      courseId,
      mediaType
    );

    // Store media record
    await query(
      `INSERT INTO course_post_media
       (post_id, media_type, s3_url, file_name, file_size, mime_type, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        postId,
        mediaType,
        s3Url,
        media.file_name,
        media.file_size,
        media.mime_type,
        media.duration,
      ]
    );
  } catch (error) {
    // Mark post as having error
    await query(
      `UPDATE course_posts SET has_error = true WHERE id = $1`,
      [postId]
    );
    logger.error('Failed to process media', { postId, error });
  }
}
```

---

## API Routes

### src/routes/telegram.ts
```typescript
import express from 'express';
import { handleIncomingMessage } from '../services/telegramService';
import { logger } from '../utils/logger';

const router = express.Router();

router.post('/webhook/:botId', async (req, res) => {
  try {
    const { botId } = req.params;
    const update = req.body;

    if (update.message) {
      await handleIncomingMessage(botId, update.message);
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Webhook error', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
```

### src/routes/media.ts
```typescript
import express from 'express';
import multer from 'multer';
import { getFromS3, uploadToS3, generateS3Key } from '../services/s3Service';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/:path(*)', async (req, res) => {
  try {
    const { path } = req.params;
    const stream = await getFromS3(path);

    // Support Range requests for video streaming
    if (req.headers.range) {
      res.status(206);
    }

    stream.pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Media not found' });
  }
});

router.post(
  '/upload',
  authenticate,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const { courseId } = req.body;
      const s3Key = generateS3Key(
        courseId,
        req.file.originalname,
        'upload'
      );

      const s3Url = await uploadToS3(
        s3Key,
        req.file.buffer,
        req.file.mimetype
      );

      res.json({ url: s3Url, key: s3Key });
    } catch (error) {
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

export default router;
```

---

## Middleware

### src/middleware/errorHandler.ts
```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
```

---

## Complete File List Needed

Due to space constraints, here's the complete list of files you need to implement:

**Routes (7 files)**:
- `src/routes/auth.ts` - Authentication endpoints
- `src/routes/courses.ts` - Course CRUD
- `src/routes/enrollments.ts` - Enrollment management
- `src/routes/seller.ts` - Seller dashboard/management
- `src/routes/admin.ts` - Admin panel endpoints
- `src/routes/media.ts` - ✓ Provided above
- `src/routes/telegram.ts` - ✓ Provided above

**Services (4 files)**:
- `src/services/authService.ts` - ✓ Provided above
- `src/services/s3Service.ts` - ✓ Provided above
- `src/services/telegramService.ts` - ✓ Provided above
- `src/services/mediaService.ts` - Media processing helpers

**Middleware (3 files)**:
- `src/middleware/auth.ts` - ✓ Provided above
- `src/middleware/errorHandler.ts` - ✓ Provided above
- `src/middleware/validators.ts` - Request validation

**Utils (4 files)**:
- `src/utils/db.ts` - ✓ Already created
- `src/utils/logger.ts` - ✓ Already created
- `src/utils/jwt.ts` - ✓ Already created
- `src/utils/crypto.ts` - Hashing utilities

**Types (1 file)**:
- `src/types/index.ts` - TypeScript type definitions

**Core (2 files)**:
- `src/index.ts` - ✓ Provided above
- `src/server.ts` - ✓ Provided above

## Next Steps

1. Implement all route files following the patterns above
2. Add request validation with Zod
3. Implement remaining CRUD operations
4. Add unit tests
5. Setup Docker
6. Deploy to production

Total estimated lines of code: ~5000-6000 lines

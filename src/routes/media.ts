import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { query } from '../utils/db.js';
import { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key, getMediaPublicUrl, getS3Object } from '../utils/s3.js';

const router = express.Router();

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
      'application/pdf',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const s3Key = generateS3Key('course-media', req.file.originalname);

    const result = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to upload to storage' });
    }

    res.json({
      path: s3Key,
      url: result.url,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

router.delete('/:path(*)', async (req: AuthRequest, res) => {
  try {
    const s3Key = (req.params as any)[0] as string;

    if (!s3Key) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    await deleteFromS3(s3Key);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.get('/public/:path(*)', async (req, res) => {
  try {
    const s3Key = (req.params as any)[0] as string;

    if (!s3Key) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const presignedUrl = await getPresignedUrl(s3Key, 3600);
    res.redirect(presignedUrl);
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

router.post('/generate-token', async (req: AuthRequest, res) => {
  try {
    const { file_id, course_id } = req.body;

    if (!file_id || !course_id) {
      return res.status(400).json({ error: 'file_id and course_id are required' });
    }

    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let hasAccess = false;

    const enrollmentResult = await query(
      'SELECT id FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
      [course_id, req.userId]
    );

    if (enrollmentResult.rows.length > 0) {
      hasAccess = true;
    }

    if (!hasAccess) {
      const courseResult = await query(
        `SELECT c.seller_id, s.user_id
         FROM courses c
         JOIN sellers s ON s.id = c.seller_id
         WHERE c.id = $1`,
        [course_id]
      );

      if (courseResult.rows.length > 0 && courseResult.rows[0].user_id === req.userId) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this course' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000);

    await query(
      `INSERT INTO media_access_tokens (token, user_id, file_id, course_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [token, req.userId, file_id, course_id, expiresAt]
    );

    res.json({
      access_token: token,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error('Generate media token error:', error);
    res.status(500).json({ error: 'Failed to create access token' });
  }
});

router.get('/presign/:path(*)', async (req: AuthRequest, res) => {
  try {
    const s3Key = (req.params as any)[0] as string;

    if (!s3Key || !req.userId) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const presignedUrl = await getPresignedUrl(s3Key, 3600);
    res.json({ url: presignedUrl });
  } catch (error) {
    logger.error('Presign error:', error);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

router.get('/telegram/:fileId/:courseId', async (req: AuthRequest, res) => {
  try {
    const { fileId, courseId } = req.params;

    const mediaResult = await query(
      `SELECT pm.storage_path, pm.telegram_file_id, pm.mime_type
       FROM course_post_media pm
       JOIN course_posts p ON pm.post_id = p.id
       WHERE (pm.telegram_file_id = $1 OR pm.telegram_thumbnail_file_id = $1)
         AND p.course_id = $2
       LIMIT 1`,
      [fileId, courseId]
    );

    if (mediaResult.rows.length > 0 && mediaResult.rows[0].storage_path) {
      const s3Key = mediaResult.rows[0].storage_path;
      try {
        const s3Buffer = await getS3Object(s3Key);
        if (s3Buffer) {
          const ext = s3Key.split('.').pop()?.toLowerCase() || '';
          res.setHeader('Content-Type', getMimeType(ext));
          res.setHeader('Content-Length', s3Buffer.length.toString());
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(s3Buffer);
        }
      } catch {
        logger.warn(`S3 key not found: ${s3Key}, falling through to Telegram proxy`);
      }
    }

    const postCheck = await query(
      `SELECT p.storage_path, p.telegram_file_id FROM course_posts p
       WHERE p.course_id = $1
       AND (p.telegram_file_id = $2 OR p.telegram_thumbnail_file_id = $2)
       LIMIT 1`,
      [courseId, fileId]
    );

    if (postCheck.rows.length > 0 && postCheck.rows[0].storage_path) {
      try {
        const s3Buffer = await getS3Object(postCheck.rows[0].storage_path);
        if (s3Buffer) {
          const ext = postCheck.rows[0].storage_path.split('.').pop()?.toLowerCase() || '';
          res.setHeader('Content-Type', getMimeType(ext));
          res.setHeader('Content-Length', s3Buffer.length.toString());
          res.setHeader('Cache-Control', 'private, max-age=3600');
          return res.send(s3Buffer);
        }
      } catch {
        logger.warn(`S3 key not found for post: ${postCheck.rows[0].storage_path}`);
      }
    }

    if (mediaResult.rows.length === 0 && postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Media not found for this course' });
    }

    const botResult = await query(
      `SELECT tb.bot_token FROM telegram_bots tb
       JOIN courses c ON tb.seller_id = c.seller_id
       WHERE c.id = $1 AND tb.is_active = true
       LIMIT 1`,
      [courseId]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'No active bot found for this course' });
    }

    const botToken = botResult.rows[0].bot_token;

    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );

    if (!fileInfoResponse.ok) {
      return res.status(502).json({ error: 'Failed to get file info from Telegram' });
    }

    const fileInfo: any = await fileInfoResponse.json();
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      return res.status(404).json({ error: 'File not found on Telegram' });
    }

    const telegramFilePath = fileInfo.result.file_path;
    const fileSize = fileInfo.result.file_size || 0;

    if (fileSize > 20 * 1024 * 1024) {
      return res.status(413).json({ error: 'File is too large (over 20 MB).' });
    }

    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${telegramFilePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      return res.status(502).json({ error: 'Failed to download file from Telegram' });
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    const ext = telegramFilePath.split('.').pop() || '';
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
      'gif': 'image/gif', 'webp': 'image/webp', 'mp4': 'video/mp4',
      'webm': 'video/webm', 'mov': 'video/quicktime', 'ogg': 'audio/ogg',
      'oga': 'audio/ogg', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    if (fileSize) res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (error) {
    logger.error('Telegram media proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy media' });
  }
});

router.get('/s3/*', async (req, res) => {
  try {
    const s3Key = req.path.replace(/^\/s3\//, '');

    if (!s3Key) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const s3Buffer = await getS3Object(s3Key);
    if (!s3Buffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = s3Key.split('.').pop()?.toLowerCase() || '';
    const contentType = getMimeType(ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', s3Buffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(s3Buffer);
  } catch (error) {
    logger.error('S3 redirect error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/course-media/*', async (req, res) => {
  try {
    const s3Key = req.path.replace(/^\//, '');

    if (!s3Key) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const s3Buffer = await getS3Object(s3Key);
    if (!s3Buffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = s3Key.split('.').pop()?.toLowerCase() || '';
    const contentType = getMimeType(ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', s3Buffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(s3Buffer);
  } catch (error) {
    logger.error('Course media error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/telegram-media/*', async (req, res) => {
  try {
    const s3Key = req.path.replace(/^\//, '');

    if (!s3Key) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const s3Buffer = await getS3Object(s3Key);
    if (!s3Buffer) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = s3Key.split('.').pop()?.toLowerCase() || '';
    const contentType = getMimeType(ext);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', s3Buffer.length.toString());
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(s3Buffer);
  } catch (error) {
    logger.error('Telegram media error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'mp4': 'video/mp4',
    'webm': 'video/webm', 'mov': 'video/quicktime', 'ogg': 'audio/ogg',
    'oga': 'audio/ogg', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
    'pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export default router;

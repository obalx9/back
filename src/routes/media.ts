import express from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { query } from '../utils/db.js';

const router = express.Router();

const MEDIA_DIR = process.env.MEDIA_STORAGE_PATH || '/tmp/media';
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(MEDIA_DIR, 'course-media');
    await fs.mkdir(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'
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

    const relativePath = path.relative(MEDIA_DIR, req.file.path);

    res.json({
      path: relativePath,
      url: `/api/media/public/${relativePath}`,
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
    const filePath = (req.params as any)[0] as string;
    const fullPath = path.join(MEDIA_DIR, filePath);

    if (!fullPath.startsWith(MEDIA_DIR)) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    await fs.unlink(fullPath);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

router.get('/public/:path(*)', async (req, res) => {
  try {
    const filePath = (req.params as any)[0] as string;
    const fullPath = path.join(MEDIA_DIR, filePath);

    if (!fullPath.startsWith(MEDIA_DIR)) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(fullPath);
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// POST /api/media/generate-token - Generate media access token
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
      `INSERT INTO media_access_tokens (token, user_id, media_path, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token, req.userId, file_id, expiresAt]
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

export default router;

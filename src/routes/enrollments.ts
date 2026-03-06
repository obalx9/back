import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/me', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await query(`
      SELECT ce.id, ce.enrolled_at, ce.expires_at,
        json_build_object(
          'id', c.id,
          'title', c.title,
          'description', c.description,
          'thumbnail_url', c.thumbnail_url
        ) as course
      FROM course_enrollments ce
      JOIN courses c ON ce.course_id = c.id
      JOIN users u ON ce.student_id = u.id
      WHERE u.id = $1
      ORDER BY ce.enrolled_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get student enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.get('/course/:courseId', async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [courseId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await query(`
      SELECT ce.id, ce.enrolled_at, ce.expires_at,
        json_build_object(
          'id', u.id,
          'user_id', u.user_id,
          'telegram_id', u.telegram_id,
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username,
          'photo_url', u.photo_url,
          'email', u.email,
          'oauth_provider', u.oauth_provider
        ) as student
      FROM course_enrollments ce
      JOIN users u ON ce.student_id = u.id
      WHERE ce.course_id = $1
      ORDER BY ce.enrolled_at DESC
    `, [courseId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get course enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { course_id, user_id: targetUserId, expires_at } = req.body;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [course_id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const studentResult = await query(
      'SELECT id FROM users WHERE user_id = $1',
      [targetUserId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const studentId = studentResult.rows[0].id;

    const existing = await query(
      'SELECT id FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
      [course_id, studentId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Student already enrolled' });
    }

    const result = await query(`
      INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [course_id, studentId, userId, expires_at || null]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Enroll student error:', error);
    res.status(500).json({ error: 'Failed to enroll student' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT ce.id FROM course_enrollments ce
      JOIN courses c ON ce.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE ce.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query('DELETE FROM course_enrollments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Remove enrollment error:', error);
    res.status(500).json({ error: 'Failed to remove enrollment' });
  }
});

export default router;

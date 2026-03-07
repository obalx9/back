import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/register', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { business_name, description } = req.body;

    if (!business_name || !business_name.trim()) {
      return res.status(400).json({ error: 'business_name is required' });
    }

    const existing = await query(
      'SELECT id FROM sellers WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Seller profile already exists', seller: existing.rows[0] });
    }

    const result = await query(
      `INSERT INTO sellers (user_id, business_name, description, is_approved)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [userId, business_name.trim(), description?.trim() || '']
    );

    await query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'seller') ON CONFLICT (user_id, role) DO NOTHING`,
      [userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Seller registration error:', error);
    res.status(500).json({ error: 'Failed to register as seller' });
  }
});

router.get('/me', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await query(
      'SELECT id, business_name, description, is_approved FROM sellers WHERE user_id = $1',
      [userId]
    );
    res.json(result.rows[0] || null);
  } catch (error) {
    logger.error('Get seller profile error:', error);
    res.status(500).json({ error: 'Failed to fetch seller profile' });
  }
});

router.get('/me/courses', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id) as enrollment_count
      FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE s.user_id = $1
      ORDER BY c.created_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get seller courses error:', error);
    res.status(500).json({ error: 'Failed to fetch seller courses' });
  }
});

export default router;

import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.use(requireRole('super_admin'));

router.get('/stats', async (req: AuthRequest, res) => {
  try {
    const [users, sellers, courses] = await Promise.all([
      query('SELECT COUNT(*) as count FROM users'),
      query('SELECT COUNT(*) as count FROM sellers'),
      query('SELECT COUNT(*) as count FROM courses')
    ]);

    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalSellers: parseInt(sellers.rows[0].count),
      totalCourses: parseInt(courses.rows[0].count)
    });
  } catch (error) {
    logger.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/sellers', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT s.*, u.first_name, u.last_name, u.email, u.telegram_username,
        (SELECT COUNT(*) FROM courses WHERE seller_id = s.id) as course_count
      FROM sellers s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get sellers error:', error);
    res.status(500).json({ error: 'Failed to fetch sellers' });
  }
});

router.delete('/sellers/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM sellers WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete seller error:', error);
    res.status(500).json({ error: 'Failed to delete seller' });
  }
});

router.get('/users', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT u.*,
        array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/sellers/approved', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT s.id, s.business_name, s.is_approved, s.premium_active, s.premium_expires_at,
        json_build_object(
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username
        ) as user
      FROM sellers s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_approved = true
      ORDER BY s.business_name
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get approved sellers error:', error);
    res.status(500).json({ error: 'Failed to fetch approved sellers' });
  }
});

router.patch('/sellers/:id/premium', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { premium_active, premium_expires_at } = req.body;

    const result = await query(`
      UPDATE sellers
      SET premium_active = $1, premium_expires_at = $2
      WHERE id = $3
      RETURNING id, business_name, is_approved, premium_active, premium_expires_at
    `, [premium_active, premium_expires_at || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update seller premium error:', error);
    res.status(500).json({ error: 'Failed to update premium status' });
  }
});

router.get('/courses', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT c.*, s.business_name as seller_name,
        (SELECT COUNT(*) FROM course_enrollments WHERE course_id = c.id) as enrollment_count
      FROM courses c
      LEFT JOIN sellers s ON c.seller_id = s.id
      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/pending-sellers', async (req: AuthRequest, res) => {
  try {
    const result = await query(`
      SELECT s.id, s.business_name, s.description, s.is_approved,
        json_build_object(
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username
        ) as user
      FROM sellers s
      JOIN users u ON s.user_id = u.id
      WHERE s.is_approved = false
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error('Get pending sellers error:', error);
    res.status(500).json({ error: 'Failed to fetch pending sellers' });
  }
});

router.put('/sellers/:id/approve', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      UPDATE sellers SET is_approved = true WHERE id = $1
      RETURNING id, business_name, is_approved
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const seller = result.rows[0];
    const sellerUserResult = await query('SELECT user_id FROM sellers WHERE id = $1', [id]);
    if (sellerUserResult.rows.length > 0) {
      await query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'seller') ON CONFLICT (user_id, role) DO NOTHING`,
        [sellerUserResult.rows[0].user_id]
      );
    }

    res.json(seller);
  } catch (error) {
    logger.error('Approve seller error:', error);
    res.status(500).json({ error: 'Failed to approve seller' });
  }
});

router.get('/telegram-main-bot', async (req: AuthRequest, res) => {
  try {
    const result = await query(
      'SELECT id, bot_token, bot_username, is_active FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get main bot error:', error);
    res.status(500).json({ error: 'Failed to fetch main bot' });
  }
});

router.post('/telegram-main-bot', async (req: AuthRequest, res) => {
  try {
    const { bot_token, bot_username } = req.body;
    if (!bot_token || !bot_username) {
      return res.status(400).json({ error: 'bot_token and bot_username are required' });
    }

    await query('UPDATE telegram_main_bot SET is_active = false');

    const result = await query(
      `INSERT INTO telegram_main_bot (bot_token, bot_username, is_active)
       VALUES ($1, $2, true)
       RETURNING id, bot_username, is_active`,
      [bot_token, bot_username]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create main bot error:', error);
    res.status(500).json({ error: 'Failed to create main bot' });
  }
});

router.put('/telegram-main-bot/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { bot_token, bot_username } = req.body;
    if (!bot_token || !bot_username) {
      return res.status(400).json({ error: 'bot_token and bot_username are required' });
    }

    const result = await query(
      `UPDATE telegram_main_bot
       SET bot_token = $1, bot_username = $2, updated_at = now()
       WHERE id = $3
       RETURNING id, bot_username, is_active`,
      [bot_token, bot_username, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update main bot error:', error);
    res.status(500).json({ error: 'Failed to update main bot' });
  }
});

export default router;

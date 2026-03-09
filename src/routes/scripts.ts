import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, code, position, is_active, order_index
       FROM site_scripts
       WHERE is_active = true
       ORDER BY order_index ASC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get scripts error:', error);
    res.status(500).json({ error: 'Failed to fetch scripts' });
  }
});

router.get('/all', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const result = await query(
      `SELECT id, name, code, position, is_active, order_index
       FROM site_scripts
       ORDER BY order_index ASC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get all scripts error:', error);
    res.status(500).json({ error: 'Failed to fetch scripts' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { name, code, position, is_active, order_index } = req.body;
    const result = await query(
      `INSERT INTO site_scripts (name, code, position, is_active, order_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, code, position ?? 'body_end', is_active ?? true, order_index ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create script error:', error);
    res.status(500).json({ error: 'Failed to create script' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { name, code, position, is_active, order_index } = req.body;
    const result = await query(
      `UPDATE site_scripts
       SET name = $1, code = $2, position = $3, is_active = $4, order_index = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, code, position ?? 'body_end', is_active ?? true, order_index ?? 0, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update script error:', error);
    res.status(500).json({ error: 'Failed to update script' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM site_scripts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete script error:', error);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

export default router;

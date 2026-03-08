import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, label, value, icon, order_index, is_active
       FROM site_metrics
       ORDER BY order_index ASC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { label, value, icon, order_index, is_active } = req.body;
    const result = await query(
      `INSERT INTO site_metrics (label, value, icon, order_index, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [label, value, icon, order_index ?? 0, is_active ?? true]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create metric error:', error);
    res.status(500).json({ error: 'Failed to create metric' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { label, value, icon, order_index, is_active } = req.body;
    const result = await query(
      `UPDATE site_metrics
       SET label = $1, value = $2, icon = $3, order_index = $4, is_active = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [label, value, icon, order_index ?? 0, is_active ?? true, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Metric not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update metric error:', error);
    res.status(500).json({ error: 'Failed to update metric' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM site_metrics WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete metric error:', error);
    res.status(500).json({ error: 'Failed to delete metric' });
  }
});

export default router;

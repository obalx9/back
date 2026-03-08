import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const result = await query(`
      SELECT * FROM featured_courses
      ${showAll ? '' : 'WHERE is_active = true'}
      ORDER BY order_index ASC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get featured courses error:', error);
    res.status(500).json({ error: 'Failed to fetch featured courses' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { title, description, category, instructor, image_url, order_index, is_active, course_id } = req.body;

    const result = await query(`
      INSERT INTO featured_courses (course_id, title, description, category, instructor, image_url, order_index, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [course_id || null, title || '', description || '', category || '', instructor || '', image_url || '', order_index || 0, is_active !== false]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create featured course error:', error);
    res.status(500).json({ error: 'Failed to create featured course' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, instructor, image_url, order_index, is_active, course_id } = req.body;

    const result = await query(`
      UPDATE featured_courses
      SET course_id = $1, title = $2, description = $3, category = $4, instructor = $5, image_url = $6, order_index = $7, is_active = $8
      WHERE id = $9
      RETURNING *
    `, [course_id || null, title, description, category, instructor, image_url, order_index, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Featured course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update featured course error:', error);
    res.status(500).json({ error: 'Failed to update featured course' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM featured_courses WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete featured course error:', error);
    res.status(500).json({ error: 'Failed to delete featured course' });
  }
});

router.put('/:id/toggle', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      UPDATE featured_courses
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Featured course not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Toggle featured course error:', error);
    res.status(500).json({ error: 'Failed to toggle featured course' });
  }
});

router.put('/:id/reorder', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { newOrderIndex, oldOrderIndex } = req.body;

    if (newOrderIndex > oldOrderIndex) {
      await query(`
        UPDATE featured_courses
        SET order_index = order_index - 1
        WHERE order_index > $1 AND order_index <= $2
      `, [oldOrderIndex, newOrderIndex]);
    } else {
      await query(`
        UPDATE featured_courses
        SET order_index = order_index + 1
        WHERE order_index >= $1 AND order_index < $2
      `, [newOrderIndex, oldOrderIndex]);
    }

    const result = await query(`
      UPDATE featured_courses
      SET order_index = $1
      WHERE id = $2
      RETURNING *
    `, [newOrderIndex, id]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Reorder featured course error:', error);
    res.status(500).json({ error: 'Failed to reorder featured course' });
  }
});

export default router;

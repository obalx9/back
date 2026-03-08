import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, label, value, icon, url, order_index, is_active
       FROM site_contacts
       ORDER BY order_index ASC`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { label, value, icon, url, order_index, is_active } = req.body;
    const result = await query(
      `INSERT INTO site_contacts (label, value, icon, url, order_index, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [label, value, icon, url ?? null, order_index ?? 0, is_active ?? true]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create contact error:', error);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { label, value, icon, url, order_index, is_active } = req.body;
    const result = await query(
      `UPDATE site_contacts
       SET label = $1, value = $2, icon = $3, url = $4, order_index = $5, is_active = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [label, value, icon, url ?? null, order_index ?? 0, is_active ?? true, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM site_contacts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;

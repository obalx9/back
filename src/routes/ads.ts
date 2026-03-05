import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.*,
        json_build_object(
          'impressions', COALESCE(SUM(CASE WHEN s.event_type = 'impression' THEN 1 ELSE 0 END), 0),
          'clicks', COALESCE(SUM(CASE WHEN s.event_type = 'click' THEN 1 ELSE 0 END), 0),
          'impressions_7d', COALESCE(SUM(CASE WHEN s.event_type = 'impression' AND s.created_at > now() - interval '7 days' THEN 1 ELSE 0 END), 0),
          'clicks_7d', COALESCE(SUM(CASE WHEN s.event_type = 'click' AND s.created_at > now() - interval '7 days' THEN 1 ELSE 0 END), 0)
        ) as stats
      FROM ad_posts a
      LEFT JOIN ad_post_stats s ON s.ad_post_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get ads error:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

router.post('/', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { title, text_content, link_url, link_label, is_active, storage_path, file_name, media_type, file_size } = req.body;

    const result = await query(`
      INSERT INTO ad_posts (title, text_content, link_url, link_label, is_active, storage_path, file_name, media_type, file_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      title || '',
      text_content || '',
      link_url || null,
      link_label || 'Подробнее',
      is_active !== false,
      storage_path || null,
      file_name || null,
      media_type || null,
      file_size || null,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create ad error:', error);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

router.put('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, text_content, link_url, link_label, is_active, storage_path, file_name, media_type, file_size } = req.body;

    const existing = await query('SELECT * FROM ad_posts WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    const current = existing.rows[0];
    const result = await query(`
      UPDATE ad_posts
      SET
        title = $1,
        text_content = $2,
        link_url = $3,
        link_label = $4,
        is_active = $5,
        storage_path = $6,
        file_name = $7,
        media_type = $8,
        file_size = $9,
        updated_at = now()
      WHERE id = $10
      RETURNING *
    `, [
      title !== undefined ? title : current.title,
      text_content !== undefined ? text_content : current.text_content,
      link_url !== undefined ? link_url : current.link_url,
      link_label !== undefined ? link_label : current.link_label,
      is_active !== undefined ? is_active : current.is_active,
      storage_path !== undefined ? storage_path : current.storage_path,
      file_name !== undefined ? file_name : current.file_name,
      media_type !== undefined ? media_type : current.media_type,
      file_size !== undefined ? file_size : current.file_size,
      id,
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update ad error:', error);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

router.delete('/:id', requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM ad_posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete ad error:', error);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

export default router;

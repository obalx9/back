import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/ad-view', async (req: AuthRequest, res) => {
  try {
    const { ad_post_id } = req.body;

    if (!ad_post_id) {
      return res.status(400).json({ error: 'ad_post_id is required' });
    }

    await query(`
      UPDATE ads_posts
      SET impressions = impressions + 1
      WHERE id = $1
    `, [ad_post_id]);

    res.status(201).json({ success: true });
  } catch (error) {
    logger.error('Record ad view error:', error);
    res.status(500).json({ error: 'Failed to record ad view' });
  }
});

export default router;

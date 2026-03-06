import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/course/:courseId', async (req: AuthRequest, res) => {
  try {
    const { courseId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const result = await query(`
      SELECT p.*,
        json_agg(
          json_build_object(
            'id', pm.id,
            'media_type', pm.media_type,
            'storage_path', pm.storage_path,
            'telegram_file_id', pm.telegram_file_id,
            'telegram_thumbnail_file_id', pm.telegram_thumbnail_file_id,
            'file_size', pm.file_size,
            'duration', pm.duration,
            'file_name', pm.file_name,
            'mime_type', pm.mime_type,
            'width', pm.width,
            'height', pm.height,
            'order_index', pm.order_index,
            'has_error', pm.has_error,
            'created_at', pm.created_at
          ) ORDER BY pm.order_index, pm.created_at
        ) FILTER (WHERE pm.id IS NOT NULL) as media
      FROM course_posts p
      LEFT JOIN course_post_media pm ON p.id = pm.post_id
      WHERE p.course_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [courseId, limit, offset]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT p.*,
        json_agg(
          json_build_object(
            'id', pm.id,
            'media_type', pm.media_type,
            'storage_path', pm.storage_path,
            'telegram_file_id', pm.telegram_file_id,
            'telegram_thumbnail_file_id', pm.telegram_thumbnail_file_id,
            'file_size', pm.file_size,
            'duration', pm.duration,
            'file_name', pm.file_name,
            'mime_type', pm.mime_type,
            'width', pm.width,
            'height', pm.height,
            'order_index', pm.order_index,
            'has_error', pm.has_error,
            'created_at', pm.created_at
          ) ORDER BY pm.order_index, pm.created_at
        ) FILTER (WHERE pm.id IS NOT NULL) as media
      FROM course_posts p
      LEFT JOIN course_post_media pm ON p.id = pm.post_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { course_id, message_text, text_content } = req.body;

    const ownerCheck = await query(`
      SELECT c.id FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND s.user_id = $2
    `, [course_id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to post to this course' });
    }

    const result = await query(`
      INSERT INTO course_posts (course_id, text_content, source_type)
      VALUES ($1, $2, 'manual')
      RETURNING *
    `, [course_id, text_content || message_text || '']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { message_text, text_content } = req.body;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const result = await query(`
      UPDATE course_posts
      SET text_content = COALESCE($1, text_content),
          updated_at = now()
      WHERE id = $2
      RETURNING *
    `, [text_content || message_text, id]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await query('DELETE FROM course_posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

router.get('/:id/media', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT * FROM course_post_media
      WHERE post_id = $1
      ORDER BY created_at
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get post media error:', error);
    res.status(500).json({ error: 'Failed to fetch post media' });
  }
});

router.post('/:id/media', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const mediaItems = req.body;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const VALID_MEDIA_TYPES = ['video', 'image', 'document', 'photo', 'audio', 'animation', 'voice', 'media_group'];
    const normalizeMediaType = (t: string) => {
      if (!t) return 'document';
      if (VALID_MEDIA_TYPES.includes(t)) return t;
      if (t === 'file') return 'document';
      return 'document';
    };
    const normalizedItems = Array.isArray(mediaItems) ? mediaItems : [mediaItems];
    const insertedMedia = [];
    for (const item of normalizedItems) {
      const result = await query(`
        INSERT INTO course_post_media (
          post_id, media_type, storage_path, telegram_thumbnail_file_id,
          file_size, duration, file_name, mime_type,
          telegram_file_id, order_index, width, height
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        id,
        normalizeMediaType(item.media_type),
        item.storage_path || null,
        item.telegram_thumbnail_file_id || null,
        item.file_size || null,
        item.duration || null,
        item.file_name || null,
        item.mime_type || null,
        item.telegram_file_id || null,
        item.order_index || 0,
        item.width || null,
        item.height || null,
      ]);
      insertedMedia.push(result.rows[0]);
    }

    res.status(201).json(insertedMedia);
  } catch (error) {
    logger.error('Add post media error:', error);
    res.status(500).json({ error: 'Failed to add post media' });
  }
});

router.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const updates = req.body;

    const ownerCheck = await query(`
      SELECT p.id FROM course_posts p
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE p.id = $1 AND s.user_id = $2
    `, [id, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['text_content', 'has_error', 'error_message', 'media_count', 'storage_path', 'telegram_file_id', 'telegram_thumbnail_file_id', 'thumbnail_storage_path', 'file_name', 'file_size', 'media_type', 'title', 'mime_type', 'source_type'];
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    fields.push(`updated_at = $${paramCount}`);
    values.push(new Date().toISOString());
    values.push(id);

    const result = await query(`
      UPDATE course_posts
      SET ${fields.join(', ')}
      WHERE id = $${paramCount + 1}
      RETURNING *
    `, values);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Patch post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

router.patch('/media/:mediaId', async (req: AuthRequest, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.userId;
    const updates = req.body;

    const ownerCheck = await query(`
      SELECT pm.id FROM course_post_media pm
      JOIN course_posts p ON pm.post_id = p.id
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE pm.id = $1 AND s.user_id = $2
    `, [mediaId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    const allowedFields = ['order_index', 'media_type', 'storage_path', 'telegram_thumbnail_file_id', 'file_name', 'file_size', 'mime_type', 'width', 'height', 'duration'];
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(mediaId);
    const result = await query(`
      UPDATE course_post_media SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *
    `, values);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Patch media error:', error);
    res.status(500).json({ error: 'Failed to update media' });
  }
});

router.delete('/media/:mediaId', async (req: AuthRequest, res) => {
  try {
    const { mediaId } = req.params;
    const userId = req.userId;

    const ownerCheck = await query(`
      SELECT pm.id FROM course_post_media pm
      JOIN course_posts p ON pm.post_id = p.id
      JOIN courses c ON p.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE pm.id = $1 AND s.user_id = $2
    `, [mediaId, userId]);

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await query('DELETE FROM course_post_media WHERE id = $1', [mediaId]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete media error:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

router.get('/pinned/:courseId/:studentId', async (req: AuthRequest, res) => {
  try {
    const { courseId, studentId } = req.params;

    const result = await query(`
      SELECT spp.*, p.text_content, p.created_at as post_created_at
      FROM student_pinned_posts spp
      JOIN course_posts p ON spp.post_id = p.id
      WHERE spp.course_id = $1 AND spp.user_id = $2
      ORDER BY spp.pinned_at DESC
    `, [courseId, studentId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get pinned posts error:', error);
    res.status(500).json({ error: 'Failed to fetch pinned posts' });
  }
});

router.post('/pinned', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { course_id, post_id } = req.body;

    const result = await query(`
      INSERT INTO student_pinned_posts (user_id, course_id, post_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, post_id) DO NOTHING
      RETURNING *
    `, [userId, course_id, post_id]);

    res.status(201).json(result.rows[0] || { user_id: userId, course_id, post_id });
  } catch (error) {
    logger.error('Pin post error:', error);
    res.status(500).json({ error: 'Failed to pin post' });
  }
});

router.delete('/pinned/:postId', async (req: AuthRequest, res) => {
  try {
    const { postId } = req.params;
    const userId = req.userId;

    await query(`
      DELETE FROM student_pinned_posts
      WHERE post_id = $1 AND user_id = $2
    `, [postId, userId]);

    res.json({ success: true });
  } catch (error) {
    logger.error('Unpin post error:', error);
    res.status(500).json({ error: 'Failed to unpin post' });
  }
});

export default router;

import express, { Request, Response } from 'express';
import {
  TelegramMessage,
  extractMediaData,
  processAndDownloadMedia
} from '../utils/telegram.js';
import { logger } from '../utils/logger.js';
import { query as dbQuery } from '../utils/db.js';

const router = express.Router();

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

async function getTelegramUpdates(botToken: string, offset: number = 0) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset,
      timeout: 5,
      allowed_updates: ['my_chat_member', 'message'],
    }),
  });

  const data: any = await response.json();
  return data.result || [];
}

// GET /api/telegram/main-bot-username
router.get('/main-bot-username', async (req: Request, res: Response) => {
  try {
    const result = await dbQuery(
      `SELECT bot_username FROM telegram_main_bot WHERE is_active = true LIMIT 1`
    );

    if (result.rows.length > 0) {
      return res.json({ bot_username: result.rows[0].bot_username });
    }

    return res.json({ bot_username: null });
  } catch (error) {
    logger.error('Error fetching main bot username:', error);
    res.status(500).json({ error: 'Failed to fetch bot username' });
  }
});

// POST /api/telegram/register-webhook
router.post('/register-webhook', async (req: Request, res: Response) => {
  try {
    const { botToken, botId, webhookUrl } = req.body;

    if (!botToken || !botId) {
      return res.status(400).json({ error: 'botToken and botId are required' });
    }

    const baseUrl = webhookUrl || process.env.API_URL || process.env.BACKEND_URL;

    if (!baseUrl) {
      return res.status(500).json({ error: 'webhookUrl or API_URL environment variable required' });
    }

    const fullWebhookUrl = `${baseUrl}/api/telegram/webhook/${botId}`;

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: fullWebhookUrl,
        allowed_updates: ['message', 'channel_post'],
        drop_pending_updates: false,
      }),
    });

    const result: any = await telegramResponse.json();

    if (result.ok) {
      const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const info: any = await infoResponse.json();

      res.json({
        success: true,
        webhookUrl: fullWebhookUrl,
        telegramResponse: result,
        webhookInfo: info,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.description || 'Failed to register webhook',
        telegramResponse: result,
      });
    }
  } catch (error) {
    console.error('Webhook registration error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/telegram/webhook/:botId
router.post('/webhook/:botId', async (req: Request, res: Response) => {
  try {
    const botId = Array.isArray(req.params.botId) ? req.params.botId[0] : req.params.botId;
    const update: TelegramUpdate = req.body;

    logger.info(`Received webhook for bot ${botId}`, { update_id: update.update_id });

    res.json({ ok: true });

    processWebhookAsync(botId, update).catch((error) => {
      logger.error('Error processing webhook:', error);
    });
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function processWebhookAsync(botId: string, update: TelegramUpdate) {
  try {
    const message = update.channel_post || update.message;

    if (!message) {
      logger.debug('No message in update');
      return;
    }

    const botResult = await dbQuery(
      'SELECT id, bot_token, seller_id FROM telegram_bots WHERE id = $1',
      [botId]
    );

    if (botResult.rows.length === 0) {
      logger.warn(`Bot ${botId} not found`);
      return;
    }

    const bot = botResult.rows[0];
    const chatId = message.chat.id;

    const courseResult = await dbQuery(
      `SELECT c.id as course_id
       FROM courses c
       WHERE c.telegram_chat_id = $1`,
      [chatId]
    );

    if (courseResult.rows.length === 0) {
      logger.debug(`Message from unlinked chat ${chatId}`);
      return;
    }

    const { course_id } = courseResult.rows[0];

    if (message.media_group_id) {
      await handleMediaGroupMessage(bot.bot_token, course_id, message);
      return;
    }

    await handleSingleMessage(bot.bot_token, course_id, message);
  } catch (error) {
    logger.error('Error in processWebhookAsync:', error);
    throw error;
  }
}

async function handleSingleMessage(
  botToken: string,
  courseId: string,
  message: TelegramMessage
) {
  try {
    const textContent = message.text || message.caption || '';

    const { mediaData, localPath, thumbnailPath } = await processAndDownloadMedia(
      botToken,
      message
    );

    const postResult = await dbQuery(
      `INSERT INTO course_posts (
        course_id,
        message_text,
        telegram_message_id,
        has_error
      ) VALUES ($1, $2, $3, $4)
      RETURNING id`,
      [
        courseId,
        textContent,
        message.message_id,
        mediaData.has_error || false,
      ]
    );

    const postId = postResult.rows[0].id;

    if (mediaData.media_type && mediaData.media_type !== 'text') {
      await dbQuery(
        `INSERT INTO course_post_media (
          post_id,
          media_type,
          telegram_file_id,
          s3_url,
          thumbnail_s3_url,
          file_size,
          file_name,
          mime_type,
          duration_seconds,
          migration_error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          postId,
          mediaData.media_type,
          mediaData.file_id || null,
          localPath || null,
          thumbnailPath || null,
          mediaData.file_size || null,
          mediaData.file_name || null,
          mediaData.mime_type || null,
          mediaData.duration || null,
          mediaData.error_message || null,
        ]
      );
    }

    logger.info(`Created post ${postId} for course ${courseId}`, {
      media_type: mediaData.media_type,
      downloaded: !!localPath,
      has_error: mediaData.has_error
    });
  } catch (error) {
    logger.error('Error handling single message:', error);
    throw error;
  }
}

async function handleMediaGroupMessage(
  botToken: string,
  courseId: string,
  message: TelegramMessage
) {
  try {
    const mediaData = extractMediaData(message);

    await dbQuery(
      `INSERT INTO telegram_media_group_buffer (
        media_group_id,
        telegram_message_id,
        file_id,
        media_type,
        file_name,
        file_size,
        mime_type,
        message_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        message.media_group_id,
        message.message_id,
        mediaData.file_id || '',
        mediaData.media_type || 'photo',
        mediaData.file_name || null,
        mediaData.file_size || null,
        mediaData.mime_type || null,
        message.caption || null,
      ]
    );

    logger.info(`Buffered media group item: ${message.media_group_id}`);

    setTimeout(async () => {
      try {
        await processMediaGroup(botToken, courseId, message.media_group_id!);
      } catch (error) {
        logger.error('Error processing media group:', error);
      }
    }, 3000);
  } catch (error) {
    logger.error('Error handling media group message:', error);
    throw error;
  }
}

async function processMediaGroup(
  botToken: string,
  courseId: string,
  mediaGroupId: string
) {
  try {
    const bufferResult = await dbQuery(
      `SELECT id, telegram_message_id, file_id, media_type, file_name, file_size, mime_type, message_text
       FROM telegram_media_group_buffer
       WHERE media_group_id = $1
       ORDER BY telegram_message_id ASC`,
      [mediaGroupId]
    );

    if (bufferResult.rows.length === 0) {
      return;
    }

    const items = bufferResult.rows;
    const caption = items.find((item: any) => item.message_text)?.message_text || '';
    const firstItem = items[0];

    const postResult = await dbQuery(
      `INSERT INTO course_posts (
        course_id,
        message_text,
        telegram_message_id
      ) VALUES ($1, $2, $3)
      RETURNING id`,
      [
        courseId,
        caption,
        firstItem.telegram_message_id,
      ]
    );

    const postId = postResult.rows[0].id;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      let localPath: string | undefined;
      let thumbnailPath: string | undefined;

      if (item.file_id) {
        const downloadResult = await processAndDownloadMedia(botToken, {
          message_id: item.telegram_message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 0, type: 'channel' },
          ...item
        });

        localPath = downloadResult.localPath;
        thumbnailPath = downloadResult.thumbnailPath;
      }

      await dbQuery(
        `INSERT INTO course_post_media (
          post_id,
          media_type,
          telegram_file_id,
          s3_url,
          thumbnail_s3_url,
          file_size,
          file_name,
          mime_type,
          media_group_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          postId,
          item.media_type,
          item.file_id || null,
          localPath || null,
          thumbnailPath || null,
          item.file_size || null,
          item.file_name || null,
          item.mime_type || null,
          mediaGroupId,
        ]
      );
    }

    await dbQuery(
      'DELETE FROM telegram_media_group_buffer WHERE media_group_id = $1',
      [mediaGroupId]
    );

    logger.info(`Processed media group ${mediaGroupId}: ${items.length} items, post ${postId}`);
  } catch (error) {
    logger.error('Error processing media group:', error);
    throw error;
  }
}

// GET /api/telegram/chat-sync/get-chats
router.get('/chat-sync/get-chats', async (req: Request, res: Response) => {
  try {
    const { bot_id } = req.query;

    if (!bot_id) {
      return res.status(400).json({ error: 'bot_id is required' });
    }

    const botResult = await dbQuery(
      'SELECT id, bot_token, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const bot = botResult.rows[0];
    const updates = await getTelegramUpdates(bot.bot_token);

    const chatsMap = new Map();
    for (const update of updates) {
      if (update.my_chat_member?.status === 'administrator') {
        const chat = update.my_chat_member.chat;
        if (!chatsMap.has(chat.id)) {
          chatsMap.set(chat.id, {
            id: chat.id,
            title: chat.title,
            type: chat.type,
          });
        }
      }
    }

    res.json({
      ok: true,
      chats: Array.from(chatsMap.values()),
    });
  } catch (error) {
    console.error('Error getting chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/telegram/chat-sync/link-chat
router.post('/chat-sync/link-chat', async (req: Request, res: Response) => {
  try {
    const { bot_id, chat_id, chat_title, chat_type, course_id } = req.body;

    if (!bot_id || !chat_id || !course_id) {
      return res.status(400).json({ error: 'bot_id, chat_id, and course_id are required' });
    }

    const botResult = await dbQuery(
      'SELECT id, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    await dbQuery(
      `UPDATE courses SET telegram_chat_id = $1 WHERE id = $2`,
      [chat_id, course_id]
    );

    await dbQuery(
      `INSERT INTO telegram_linked_chats (course_id, chat_id, chat_type, chat_title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id) DO UPDATE
       SET course_id = $1, chat_title = $4`,
      [course_id, chat_id, chat_type || 'channel', chat_title || null]
    );

    res.json({
      ok: true,
      message: 'Chat successfully linked to course',
    });
  } catch (error) {
    console.error('Error linking chat:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

// DELETE /api/telegram/chat-sync/unlink-chat
router.delete('/chat-sync/unlink-chat', async (req: Request, res: Response) => {
  try {
    const { bot_id, chat_id, course_id } = req.body;

    if (!bot_id || !chat_id || !course_id) {
      return res.status(400).json({ error: 'bot_id, chat_id, and course_id are required' });
    }

    await dbQuery(
      'DELETE FROM telegram_linked_chats WHERE chat_id = $1 AND course_id = $2',
      [chat_id, course_id]
    );

    await dbQuery(
      `UPDATE courses SET telegram_chat_id = NULL WHERE id = $1 AND telegram_chat_id = $2`,
      [course_id, chat_id]
    );

    res.json({
      ok: true,
      message: 'Chat successfully unlinked',
    });
  } catch (error) {
    console.error('Error unlinking chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/telegram/chat-sync/unlink-chat (alias for DELETE, accepts body)
router.post('/chat-sync/unlink-chat', async (req: Request, res: Response) => {
  try {
    const { bot_id, chat_id, course_id } = req.body;

    if (!bot_id || !chat_id || !course_id) {
      return res.status(400).json({ error: 'bot_id, chat_id, and course_id are required' });
    }

    await dbQuery(
      'DELETE FROM telegram_linked_chats WHERE chat_id = $1 AND course_id = $2',
      [chat_id, course_id]
    );

    await dbQuery(
      `UPDATE courses SET telegram_chat_id = NULL WHERE id = $1 AND telegram_chat_id = $2`,
      [course_id, chat_id]
    );

    res.json({ ok: true, message: 'Chat successfully unlinked' });
  } catch (error) {
    console.error('Error unlinking chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/telegram/bots/:id
router.get('/bots/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await dbQuery(
      'SELECT id, bot_token, bot_username, seller_id, is_active, channel_id FROM telegram_bots WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get bot error:', error);
    res.status(500).json({ error: 'Failed to fetch bot' });
  }
});

// PUT /api/telegram/bots/:id
router.put('/bots/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { bot_token, bot_username, is_active, channel_id } = req.body;

    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (bot_token !== undefined) { fields.push(`bot_token = $${paramCount++}`); values.push(bot_token); }
    if (bot_username !== undefined) { fields.push(`bot_username = $${paramCount++}`); values.push(bot_username); }
    if (is_active !== undefined) { fields.push(`is_active = $${paramCount++}`); values.push(is_active); }
    if (channel_id !== undefined) { fields.push(`channel_id = $${paramCount++}`); values.push(channel_id); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await dbQuery(
      `UPDATE telegram_bots SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update bot error:', error);
    res.status(500).json({ error: 'Failed to update bot' });
  }
});

// DELETE /api/telegram/bots/:id
router.delete('/bots/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await dbQuery('UPDATE telegram_bots SET is_active = false WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    logger.error('Deactivate bot error:', error);
    res.status(500).json({ error: 'Failed to deactivate bot' });
  }
});

// GET /api/telegram/chat-sync/list-chats
router.get('/chat-sync/list-chats', async (req: Request, res: Response) => {
  try {
    const { bot_id } = req.query;

    if (!bot_id) {
      return res.status(400).json({ error: 'bot_id is required' });
    }

    const botResult = await dbQuery(
      'SELECT id, seller_id FROM telegram_bots WHERE id = $1',
      [bot_id]
    );

    if (botResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const sellerId = botResult.rows[0].seller_id;

    const chatsResult = await dbQuery(
      `SELECT tlc.id, tlc.chat_id as telegram_chat_id, tlc.chat_title, tlc.chat_type, tlc.course_id
       FROM telegram_linked_chats tlc
       JOIN courses c ON c.id = tlc.course_id
       WHERE c.seller_id = $1`,
      [sellerId]
    );

    res.json({
      ok: true,
      chats: chatsResult.rows,
    });
  } catch (error) {
    console.error('Error listing chats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../utils/db.js';
import { generateToken, verifyToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

function verifyTelegramAuth(data: any, botToken: string): boolean {
  const { hash, ...authData } = data;

  const dataCheckString = Object.keys(authData)
    .sort()
    .map(key => `${key}=${authData[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return hmac === hash;
}

function generateUserId(): string {
  return crypto.randomUUID();
}

router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const authData = req.body;

    if (!authData.id || !authData.hash) {
      return res.status(400).json({ error: 'Invalid auth data' });
    }

    const botResult = await query(
      'SELECT bot_token FROM telegram_main_bot WHERE is_active = true LIMIT 1'
    );

    const botToken = botResult.rows.length > 0
      ? botResult.rows[0].bot_token
      : process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return res.status(500).json({ error: 'Telegram bot not configured' });
    }

    const isValid = verifyTelegramAuth(authData, botToken);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid Telegram authentication' });
    }

    const authDate = new Date(authData.auth_date * 1000);
    const now = new Date();
    const timeDiff = now.getTime() - authDate.getTime();
    if (timeDiff > 86400000) {
      return res.status(401).json({ error: 'Authentication data is too old' });
    }

    const userResult = await query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [authData.id]
    );

    let userId: string;

    if (userResult.rows.length > 0) {
      await query(
        `UPDATE users
         SET telegram_username = $1, first_name = $2, last_name = $3, photo_url = $4
         WHERE id = $5`,
        [authData.username, authData.first_name, authData.last_name, authData.photo_url, userResult.rows[0].id]
      );
      userId = userResult.rows[0].id;
    } else {
      const newUserResult = await query(
        `INSERT INTO users (user_id, telegram_id, telegram_username, first_name, last_name, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [generateUserId(), authData.id, authData.username, authData.first_name, authData.last_name, authData.photo_url]
      );
      userId = newUserResult.rows[0].id;

      await query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, 'student']
      );
    }

    const rolesResult = await query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [userId]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);

    const pendingResult = await query(
      `SELECT * FROM pending_enrollments WHERE student_id = $1 AND status = 'pending'`,
      [userId]
    );

    for (const pending of pendingResult.rows) {
      await query(
        `INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [pending.course_id, userId, pending.granted_by, pending.expires_at]
      );

      await query('DELETE FROM pending_enrollments WHERE id = $1', [pending.id]);
    }

    const token = generateToken({ userId, telegramId: authData.id, roles });

    res.json({
      success: true,
      user_id: userId,
      roles,
      token,
    });
  } catch (error) {
    logger.error('Telegram auth error:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Internal server error', detail: message });
  }
});

router.post('/oauth/session', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const userResult = await query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const rolesResult = await query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [user.id]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);

    const token = generateToken({
      userId: user.id,
      oauthProvider: user.oauth_provider,
      oauthId: user.oauth_provider_id,
      roles
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        photo_url: user.photo_url,
        roles,
      },
    });
  } catch (error) {
    logger.error('OAuth session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sync-metadata', async (req: Request, res: Response) => {
  try {
    const usersResult = await query(
      'SELECT id, telegram_id, telegram_username, first_name, last_name, photo_url FROM users'
    );

    let updatedCount = 0;
    let errorCount = 0;

    for (const user of usersResult.rows) {
      try {
        await query('SELECT role FROM user_roles WHERE user_id = $1', [user.id]);
        updatedCount++;
      } catch (err) {
        logger.error(`Error updating user ${user.id}:`, err);
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: `Updated ${updatedCount} users, ${errorCount} errors`,
      updated: updatedCount,
      errors: errorCount,
    });
  } catch (error) {
    logger.error('Error syncing user metadata:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/user-roles/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const userResult = await query('SELECT id FROM users WHERE id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rolesResult = await query('SELECT role FROM user_roles WHERE user_id = $1', [userId]);

    res.json({
      success: true,
      roles: rolesResult.rows.map((r: any) => r.role),
    });
  } catch (error) {
    logger.error('Error updating user roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);

    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = payload.sub;

    const userResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const rolesResult = await query('SELECT role FROM user_roles WHERE user_id = $1', [userId]);
    const roles = rolesResult.rows.map((r: any) => r.role);

    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    const seller = sellerResult.rows[0] || null;

    const is_admin = roles.includes('super_admin');
    const is_seller = !!seller;
    const seller_id = seller ? seller.id : null;

    res.json({
      user: {
        id: user.id,
        user_id: user.user_id,
        telegram_id: user.telegram_id,
        telegram_username: user.telegram_username,
        first_name: user.first_name,
        last_name: user.last_name,
        photo_url: user.photo_url,
        email: user.email,
        oauth_provider: user.oauth_provider || null,
        is_admin,
        is_seller,
        seller_id,
      },
      roles,
    });
  } catch (error) {
    logger.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin-link', async (req: Request, res: Response) => {
  try {
    const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?token=admin-test-token`;
    res.json({ link });
  } catch (error) {
    console.error('Error generating admin link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  res.json({ success: true });
});

router.post('/update-roles', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload || !payload.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { roles } = req.body;
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'roles must be an array' });
    }

    const userId = payload.sub;
    const validRoles = ['student', 'seller', 'super_admin'];
    const filteredRoles = roles.filter((r: string) => validRoles.includes(r));

    for (const role of filteredRoles) {
      await query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING',
        [userId, role]
      );
    }

    res.json({ success: true, roles: filteredRoles });
  } catch (error) {
    logger.error('Update roles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

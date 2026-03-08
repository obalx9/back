import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import { query } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { generateToken } from '../utils/jwt.js';

const router = express.Router();

interface VKUserInfo {
  user: {
    user_id: string;
    first_name: string;
    last_name: string;
    avatar?: string;
  };
}

interface YandexUserInfo {
  id: string;
  first_name: string;
  last_name: string;
  default_email?: string;
  emails?: string[];
}

function generateUserId(): string {
  return crypto.randomUUID();
}

async function createOrUpdateUser(
  provider: string,
  providerId: string,
  userData: {
    first_name: string;
    last_name?: string;
    photo_url?: string;
    email?: string;
  }
) {
  const existingResult = await query(
    `SELECT id, user_id FROM users
     WHERE oauth_provider = $1 AND oauth_id = $2`,
    [provider, providerId.toString()]
  );

  if (existingResult.rows.length > 0) {
    const user = existingResult.rows[0];
    if (userData.email) {
      await query(
        'UPDATE users SET email = $1 WHERE id = $2',
        [userData.email, user.id]
      );
    }
    return user;
  }

  const newUserId = generateUserId();

  const insertResult = await query(
    `INSERT INTO users (
      user_id, oauth_provider, oauth_id, telegram_id,
      first_name, last_name, photo_url, email
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, user_id`,
    [
      newUserId,
      provider,
      providerId.toString(),
      null,
      userData.first_name,
      userData.last_name || null,
      userData.photo_url || null,
      userData.email || null
    ]
  );

  const newUser = insertResult.rows[0];

  await query(
    `INSERT INTO user_roles (user_id, role)
     VALUES ($1, 'student')
     ON CONFLICT (user_id, role) DO NOTHING`,
    [newUser.id]
  );

  return newUser;
}

// GET /api/oauth/vk - Initiate VK OAuth flow
router.get('/vk', async (req: Request, res: Response) => {
  const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
  const BACKEND_URL = process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:3000';
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  if (!VK_CLIENT_ID) {
    return res.redirect(`${APP_URL}/login?error=VK OAuth not configured`);
  }

  try {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifierBytes = crypto.randomBytes(64);
    const codeVerifier = codeVerifierBytes.toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const deviceId = crypto.randomBytes(16).toString('hex');

    await query(
      `INSERT INTO pkce_sessions (state, code_verifier, redirect_url)
       VALUES ($1, $2, $3)`,
      [state, codeVerifier, null]
    );

    const redirectUri = process.env.VK_REDIRECT_URI || `${BACKEND_URL}/api/oauth/vk/callback`;
    const authUrl = new URL('https://id.vk.ru/authorize');
    authUrl.searchParams.set('client_id', VK_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'vkid.personal_info');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('device_id', deviceId);

    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('VK OAuth init error:', error);
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent('VK OAuth initiation failed: ' + (error instanceof Error ? error.message : String(error)))}`);
  }
});

// GET /api/oauth/yandex - Initiate Yandex OAuth flow
router.get('/yandex', async (req: Request, res: Response) => {
  const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  if (!YANDEX_CLIENT_ID) {
    return res.redirect(`${APP_URL}/login?error=Yandex OAuth not configured`);
  }

  const redirectUri = `${APP_URL}/auth/yandex/callback`;
  const authUrl = new URL('https://oauth.yandex.ru/authorize');
  authUrl.searchParams.set('client_id', YANDEX_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('force_confirm', 'yes');

  res.redirect(authUrl.toString());
});

// POST /api/oauth/pkce-session - Store PKCE session
router.post('/pkce-session', async (req: Request, res: Response) => {
  try {
    const { state, code_verifier, redirect_url } = req.body;

    if (!state || !code_verifier) {
      return res.status(400).json({ error: 'state and code_verifier are required' });
    }

    await query(
      `INSERT INTO pkce_sessions (state, code_verifier, redirect_url)
       VALUES ($1, $2, $3)`,
      [state, code_verifier, redirect_url || null]
    );

    res.json({ ok: true });
  } catch (error) {
    logger.error('PKCE session error:', error);
    res.status(500).json({ error: 'Failed to store PKCE session' });
  }
});

// GET /api/oauth/vk/callback - VK OAuth callback
router.get('/vk/callback', async (req: Request, res: Response) => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  try {
    const { code, state, device_id } = req.query;
    const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
    const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;

    if (!VK_CLIENT_ID || !VK_CLIENT_SECRET) {
      return res.redirect(`${APP_URL}/login?error=VK OAuth not configured`);
    }

    if (!code) {
      return res.redirect(`${APP_URL}/login?error=No authorization code provided`);
    }

    const pkceResult = await query(
      `SELECT code_verifier, redirect_url FROM pkce_sessions
       WHERE state = $1 AND expires_at > NOW()`,
      [state || '']
    );

    if (pkceResult.rows.length === 0) {
      return res.redirect(`${APP_URL}/login?error=Session expired or invalid`);
    }

    const pkceSession = pkceResult.rows[0];

    await query('DELETE FROM pkce_sessions WHERE state = $1', [state]);

    const VK_REDIRECT_URI = process.env.VK_REDIRECT_URI || `${process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:3000'}/api/oauth/vk/callback`;

    const tokenResponse = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        code_verifier: pkceSession.code_verifier,
        client_id: VK_CLIENT_ID,
        client_secret: VK_CLIENT_SECRET,
        device_id: (device_id as string) || '',
        redirect_uri: VK_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      logger.error('VK token error:', tokenData);
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    }

    const userInfoResponse = await fetch('https://id.vk.ru/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: tokenData.access_token,
        client_id: VK_CLIENT_ID,
      }),
    });

    const userInfoData = await userInfoResponse.json() as VKUserInfo;

    if (!userInfoData.user) {
      return res.redirect(`${APP_URL}/login?error=Failed to get VK user info`);
    }

    const vkUser = userInfoData.user;

    const user = await createOrUpdateUser('vk', vkUser.user_id, {
      first_name: vkUser.first_name,
      last_name: vkUser.last_name,
      photo_url: vkUser.avatar || undefined,
    });

    const rolesResult = await query(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [user.id]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);
    const token = generateToken({ userId: user.id, roles });

    logger.info('VK OAuth success', { user_id: user.user_id });

    const finalUrl = new URL('/auth/vk/callback', APP_URL);
    finalUrl.searchParams.set('token', token);
    finalUrl.searchParams.set('user_id', user.user_id);

    res.redirect(finalUrl.toString());
  } catch (error) {
    logger.error('VK OAuth callback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// GET /api/oauth/yandex/callback - Yandex OAuth callback
router.get('/yandex/callback', async (req: Request, res: Response) => {
  const APP_URL = process.env.APP_URL || 'http://localhost:5173';

  try {
    const { code } = req.query;
    const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
    const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;

    if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET) {
      return res.redirect(`${APP_URL}/login?error=Yandex OAuth not configured`);
    }

    if (!code) {
      return res.redirect(`${APP_URL}/login?error=No authorization code provided`);
    }

    const YANDEX_REDIRECT_URI = process.env.YANDEX_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5173'}/auth/yandex/callback`;

    const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
        redirect_uri: YANDEX_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      logger.error('Yandex token error:', tokenData);
      return res.redirect(`${APP_URL}/login?error=${encodeURIComponent(tokenData.error)}`);
    }

    const userInfoResponse = await fetch('https://login.yandex.ru/info', {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });

    const userInfo = await userInfoResponse.json() as YandexUserInfo;

    if (!userInfo.id) {
      return res.redirect(`${APP_URL}/login?error=Failed to get Yandex user info`);
    }

    const user = await createOrUpdateUser('yandex', userInfo.id, {
      first_name: userInfo.first_name,
      last_name: userInfo.last_name,
      email: userInfo.default_email || (userInfo.emails && userInfo.emails[0]) || undefined,
    });

    const rolesResult = await query(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [user.id]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);

    const token = generateToken({ userId: user.id, roles });

    logger.info('Yandex OAuth success', { user_id: user.user_id });

    const redirectUrl = new URL('/auth/yandex/callback', APP_URL);
    redirectUrl.searchParams.set('token', token);
    redirectUrl.searchParams.set('user_id', user.user_id);

    res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error('Yandex OAuth callback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

// POST /api/oauth/vk/exchange - Exchange VK access_token (from VK ID SDK) for our JWT
router.post('/vk/exchange', async (req: Request, res: Response) => {
  try {
    const { access_token, user_id: vkUserId, code, code_verifier, device_id, redirect_uri: clientRedirectUri } = req.body;
    const VK_CLIENT_ID = process.env.VK_CLIENT_ID;
    const VK_CLIENT_SECRET = process.env.VK_CLIENT_SECRET;
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';

    if (!VK_CLIENT_ID) {
      return res.status(500).json({ error: 'VK OAuth not configured' });
    }

    let vkAccessToken: string;

    if (access_token) {
      vkAccessToken = access_token;
    } else if (code && code_verifier) {
      if (!VK_CLIENT_SECRET) {
        return res.status(500).json({ error: 'VK OAuth not configured' });
      }

      const VK_REDIRECT_URI = clientRedirectUri || process.env.VK_FRONTEND_REDIRECT_URI || `${APP_URL}/auth/vk/callback`;

      const vkTokenParams: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        code_verifier,
        client_id: VK_CLIENT_ID,
        client_secret: VK_CLIENT_SECRET,
        redirect_uri: VK_REDIRECT_URI,
      };
      if (device_id) vkTokenParams.device_id = device_id;

      const tokenResponse = await fetch('https://id.vk.ru/oauth2/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(vkTokenParams),
      });

      const tokenData: any = await tokenResponse.json();

      if (tokenData.error) {
        return res.status(400).json({ error: tokenData.error_description || tokenData.error });
      }

      vkAccessToken = tokenData.access_token;
    } else {
      return res.status(400).json({ error: 'access_token or code+code_verifier are required' });
    }

    const userInfoResponse = await fetch('https://id.vk.ru/oauth2/user_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: vkAccessToken,
        client_id: VK_CLIENT_ID,
      }),
    });

    const userInfoData = await userInfoResponse.json() as VKUserInfo;

    if (!userInfoData.user) {
      return res.status(400).json({ error: 'Failed to get VK user info' });
    }

    const vkUser = userInfoData.user;

    const user = await createOrUpdateUser('vk', vkUser.user_id, {
      first_name: vkUser.first_name,
      last_name: vkUser.last_name,
      photo_url: vkUser.avatar || undefined,
    });

    const rolesResult = await query(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [user.id]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);

    const token = generateToken({
      userId: user.id,
      roles,
    });

    res.json({
      user_id: user.user_id,
      token,
    });
  } catch (error) {
    logger.error('VK exchange error:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to exchange VK code', detail: message });
  }
});

// POST /api/oauth/yandex/exchange - Exchange Yandex code for JWT
router.post('/yandex/exchange', async (req: Request, res: Response) => {
  try {
    const { code, redirect_uri: clientRedirectUri } = req.body;
    const YANDEX_CLIENT_ID = process.env.YANDEX_CLIENT_ID;
    const YANDEX_CLIENT_SECRET = process.env.YANDEX_CLIENT_SECRET;
    const APP_URL = process.env.APP_URL || 'http://localhost:5173';

    if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Yandex OAuth not configured' });
    }

    if (!code) {
      return res.status(400).json({ error: 'code is required' });
    }

    const YANDEX_REDIRECT_URI = `${APP_URL}/auth/yandex/callback`;

    const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
        redirect_uri: YANDEX_REDIRECT_URI,
      }),
    });

    const tokenData: any = await tokenResponse.json();

    if (tokenData.error) {
      return res.status(400).json({ error: tokenData.error_description || tokenData.error });
    }

    const userInfoResponse = await fetch('https://login.yandex.ru/info', {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });

    const userInfo: any = await userInfoResponse.json();

    if (!userInfo.id) {
      return res.status(400).json({ error: 'Failed to get Yandex user info' });
    }

    const user = await createOrUpdateUser('yandex', userInfo.id, {
      first_name: userInfo.first_name,
      last_name: userInfo.last_name,
      email: userInfo.default_email || (userInfo.emails && userInfo.emails[0]) || undefined,
    });

    const rolesResult = await query(
      `SELECT role FROM user_roles WHERE user_id = $1`,
      [user.id]
    );
    const roles = rolesResult.rows.map((r: any) => r.role);

    const token = generateToken({
      userId: user.id,
      roles,
    });

    res.json({
      user_id: user.user_id,
      token,
    });
  } catch (error) {
    logger.error('Yandex exchange error:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to exchange Yandex code', detail: message });
  }
});

export default router;

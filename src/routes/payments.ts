import express from 'express';
import { query } from '../utils/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || '';
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || '';
const PLATFORM_FEE_PERCENT = 10;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// Tax system: usn_income, usn_income_outcome, envd, esn, patent, osn
// VAT code: 1=без НДС, 2=0%, 3=10%, 4=20%
const VAT_CODE = parseInt(process.env.YOOKASSA_VAT_CODE || '1', 10);

function yookassaAuth() {
  return 'Basic ' + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64');
}

function yookassaConfigured() {
  return YOOKASSA_SHOP_ID.length > 0 && YOOKASSA_SECRET_KEY.length > 0;
}

// GET /api/payments/course/:courseId/public — public course info for payment page
router.get('/course/:courseId/public', async (req, res) => {
  try {
    const { courseId } = req.params;
    const result = await query(`
      SELECT c.id, c.title, c.description, c.thumbnail_url, c.price, c.payment_enabled,
        s.business_name as seller_name,
        (SELECT COUNT(*) FROM course_posts WHERE course_id = c.id) as post_count
      FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      WHERE c.id = $1 AND c.is_published = true
    `, [courseId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = result.rows[0];
    if (!course.payment_enabled) {
      return res.status(400).json({ error: 'Payment not enabled for this course' });
    }

    res.json(course);
  } catch (error) {
    logger.error('Get public course error:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// GET /api/payments/promo/validate — validate a promo code (auth required)
router.get('/promo/validate', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { code, course_id } = req.query as Record<string, string>;

    if (!code || !course_id) {
      return res.status(400).json({ error: 'code and course_id are required' });
    }

    // Get course price and seller
    const courseResult = await query(
      'SELECT id, title, price, payment_enabled, seller_id FROM courses WHERE id = $1 AND is_published = true',
      [course_id]
    );
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const course = courseResult.rows[0];

    // Look up promo code for this seller — must match seller and optionally course
    const promoResult = await query(`
      SELECT pc.*
      FROM promo_codes pc
      JOIN sellers s ON pc.seller_id = s.id
      WHERE UPPER(pc.code) = UPPER($1)
        AND pc.seller_id = $2
        AND pc.is_active = true
        AND (pc.course_id IS NULL OR pc.course_id = $3)
        AND (pc.max_uses IS NULL OR pc.uses_count < pc.max_uses)
        AND (pc.expires_at IS NULL OR pc.expires_at > now())
    `, [code, course.seller_id, course_id]);

    if (promoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Промокод недействителен или уже использован' });
    }

    const promo = promoResult.rows[0];

    // Check user hasn't already used this promo code
    const usedCheck = await query(
      'SELECT id FROM promo_code_uses WHERE promo_code_id = $1 AND user_id = $2',
      [promo.id, userId]
    );
    if (usedCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Вы уже использовали этот промокод' });
    }

    // Calculate discount
    let discountAmount = 0;
    if (promo.discount_type === 'percent') {
      discountAmount = Math.round(course.price * promo.discount_value / 100);
    } else {
      discountAmount = Math.min(promo.discount_value, course.price);
    }
    const finalPrice = Math.max(0, course.price - discountAmount);

    res.json({
      valid: true,
      promo_code_id: promo.id,
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      discount_amount: discountAmount,
      original_price: course.price,
      final_price: finalPrice,
    });
  } catch (error) {
    logger.error('Validate promo code error:', error);
    res.status(500).json({ error: 'Failed to validate promo code' });
  }
});

// ─── SELLER PROMO CODE MANAGEMENT ──────────────────────────────────────────

// GET /api/payments/promo/seller — list seller's own promo codes
router.get('/promo/seller', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    const result = await query(`
      SELECT pc.*,
        c.title as course_title,
        (
          SELECT COUNT(*) FROM promo_code_uses pcu WHERE pcu.promo_code_id = pc.id
        ) as total_uses,
        (
          SELECT COALESCE(SUM(pcu.discount_amount), 0) FROM promo_code_uses pcu WHERE pcu.promo_code_id = pc.id
        ) as total_discount_given
      FROM promo_codes pc
      LEFT JOIN courses c ON pc.course_id = c.id
      WHERE pc.seller_id = $1
      ORDER BY pc.created_at DESC
    `, [sellerId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get promo codes error:', error);
    res.status(500).json({ error: 'Failed to fetch promo codes' });
  }
});

// POST /api/payments/promo/seller — create a promo code
router.post('/promo/seller', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    const { code, discount_type, discount_value, course_id, max_uses, expires_at } = req.body;

    if (!code || !discount_type || !discount_value) {
      return res.status(400).json({ error: 'code, discount_type, discount_value are required' });
    }
    if (!['percent', 'fixed'].includes(discount_type)) {
      return res.status(400).json({ error: 'discount_type must be percent or fixed' });
    }
    if (discount_type === 'percent' && (discount_value < 1 || discount_value > 100)) {
      return res.status(400).json({ error: 'Percent discount must be 1-100' });
    }

    // Verify course belongs to seller if provided
    if (course_id) {
      const courseCheck = await query(
        'SELECT id FROM courses WHERE id = $1 AND seller_id = $2',
        [course_id, sellerId]
      );
      if (courseCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Course not found or not yours' });
      }
    }

    const result = await query(`
      INSERT INTO promo_codes (seller_id, course_id, code, discount_type, discount_value, max_uses, expires_at)
      VALUES ($1, $2, UPPER($3), $4, $5, $6, $7)
      RETURNING *
    `, [sellerId, course_id || null, code, discount_type, discount_value, max_uses || null, expires_at || null]);

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Промокод с таким кодом уже существует' });
    }
    logger.error('Create promo code error:', error);
    res.status(500).json({ error: 'Failed to create promo code' });
  }
});

// PATCH /api/payments/promo/seller/:id — update (toggle active, etc.)
router.patch('/promo/seller/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    const { is_active, max_uses, expires_at } = req.body;

    const result = await query(`
      UPDATE promo_codes
      SET
        is_active = COALESCE($1, is_active),
        max_uses = COALESCE($2, max_uses),
        expires_at = COALESCE($3, expires_at),
        updated_at = now()
      WHERE id = $4 AND seller_id = $5
      RETURNING *
    `, [is_active, max_uses, expires_at, id, sellerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Promo code not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update promo code error:', error);
    res.status(500).json({ error: 'Failed to update promo code' });
  }
});

// DELETE /api/payments/promo/seller/:id
router.delete('/promo/seller/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    const result = await query(
      'DELETE FROM promo_codes WHERE id = $1 AND seller_id = $2 AND uses_count = 0 RETURNING id',
      [id, sellerId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Промокод не найден или уже использован (нельзя удалить)' });
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('Delete promo code error:', error);
    res.status(500).json({ error: 'Failed to delete promo code' });
  }
});

// POST /api/payments/create — create a YooKassa payment (auth required)
router.post('/create', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { course_id, promo_code } = req.body;

    if (!course_id) {
      return res.status(400).json({ error: 'course_id is required' });
    }

    const courseResult = await query(
      'SELECT id, title, price, payment_enabled, seller_id FROM courses WHERE id = $1 AND is_published = true',
      [course_id]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = courseResult.rows[0];

    if (!course.payment_enabled || !course.price || course.price <= 0) {
      return res.status(400).json({ error: 'Payment not available for this course' });
    }

    // Check if already enrolled
    const enrolledCheck = await query(`
      SELECT ce.id FROM course_enrollments ce
      JOIN users u ON ce.student_id = u.id
      WHERE ce.course_id = $1 AND u.id = $2
    `, [course_id, userId]);

    if (enrolledCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Already enrolled in this course' });
    }

    // Validate and apply promo code if provided
    let promoCodeId: string | null = null;
    let discountAmount = 0;

    if (promo_code) {
      const promoResult = await query(`
        SELECT pc.*
        FROM promo_codes pc
        WHERE UPPER(pc.code) = UPPER($1)
          AND pc.seller_id = $2
          AND pc.is_active = true
          AND (pc.course_id IS NULL OR pc.course_id = $3)
          AND (pc.max_uses IS NULL OR pc.uses_count < pc.max_uses)
          AND (pc.expires_at IS NULL OR pc.expires_at > now())
      `, [promo_code, course.seller_id, course_id]);

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0];
        const usedCheck = await query(
          'SELECT id FROM promo_code_uses WHERE promo_code_id = $1 AND user_id = $2',
          [promo.id, userId]
        );
        if (usedCheck.rows.length === 0) {
          promoCodeId = promo.id;
          if (promo.discount_type === 'percent') {
            discountAmount = Math.round(course.price * promo.discount_value / 100);
          } else {
            discountAmount = Math.min(promo.discount_value, course.price);
          }
        }
      }
    }

    // Check for existing pending order (without promo — new promo needs new order)
    if (!promo_code) {
      const existingOrder = await query(
        "SELECT id, yookassa_payment_url FROM orders WHERE course_id = $1 AND user_id = $2 AND status = 'pending'",
        [course_id, userId]
      );
      if (existingOrder.rows.length > 0 && existingOrder.rows[0].yookassa_payment_url) {
        return res.json({
          payment_url: existingOrder.rows[0].yookassa_payment_url,
          order_id: existingOrder.rows[0].id,
        });
      }
    }

    if (!yookassaConfigured()) {
      logger.error('YooKassa credentials are not configured (YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY)');
      return res.status(500).json({ error: 'YooKassa не настроен: отсутствуют YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY на сервере' });
    }

    // Fetch buyer's email for the fiscal receipt (required by 54-FZ)
    const userResult = await query('SELECT email, first_name, last_name FROM users WHERE id = $1', [userId]);
    const buyerEmail = userResult.rows[0]?.email || null;

    if (!buyerEmail) {
      return res.status(400).json({ error: 'Для оплаты необходим email. Пожалуйста, укажите email в профиле.' });
    }

    const originalAmount = course.price;
    const amount = Math.max(0, originalAmount - discountAmount);
    const platformFee = Math.round(amount * PLATFORM_FEE_PERCENT / 100);
    const sellerAmount = amount - platformFee;

    // YooKassa: max 64 chars for Idempotence-Key
    const rawKey = `${userId}-${course_id}-${Date.now()}`;
    const idempotenceKey = rawKey.length <= 64 ? rawKey : rawKey.slice(rawKey.length - 64);
    const description = `Курс: ${course.title}`.slice(0, 128);

    const receipt = {
      customer: { email: buyerEmail },
      items: [
        {
          description: course.title.slice(0, 128),
          quantity: '1.00',
          amount: {
            value: (amount / 100).toFixed(2),
            currency: 'RUB',
          },
          vat_code: VAT_CODE,
          payment_mode: 'full_payment',
          payment_subject: 'service',
        },
      ],
    };

    const yookassaResponse = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': yookassaAuth(),
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify({
        amount: {
          value: (amount / 100).toFixed(2),
          currency: 'RUB',
        },
        confirmation: {
          type: 'redirect',
          return_url: `${FRONTEND_URL}/pay/${course_id}?status=success`,
        },
        capture: true,
        description,
        receipt,
        metadata: {
          course_id: String(course_id),
          user_id: String(userId),
        },
      }),
    });

    if (!yookassaResponse.ok) {
      const raw = await yookassaResponse.text();
      let parsed: any = null;
      try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
      logger.error('YooKassa create payment error', {
        status: yookassaResponse.status,
        body: parsed ?? raw,
      });
      const description = parsed?.description || parsed?.error_description || raw || 'Unknown error';
      return res.status(502).json({
        error: `YooKassa: ${description}`,
        yookassa_status: yookassaResponse.status,
        yookassa_code: parsed?.code,
        yookassa_parameter: parsed?.parameter,
      });
    }

    const payment = await yookassaResponse.json() as {
      id: string;
      confirmation?: { confirmation_url?: string };
    };

    const orderResult = await query(`
      INSERT INTO orders (course_id, user_id, amount, platform_fee, seller_amount, status, yookassa_payment_id, yookassa_payment_url, metadata, promo_code_id, discount_amount, original_amount)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      course_id,
      userId,
      amount,
      platformFee,
      sellerAmount,
      payment.id,
      payment.confirmation?.confirmation_url || null,
      JSON.stringify({ idempotence_key: idempotenceKey }),
      promoCodeId,
      discountAmount,
      originalAmount,
    ]);

    // Record promo code use and increment counter
    if (promoCodeId && discountAmount > 0) {
      await query(
        'INSERT INTO promo_code_uses (promo_code_id, order_id, user_id, discount_amount) VALUES ($1, $2, $3, $4)',
        [promoCodeId, orderResult.rows[0].id, userId, discountAmount]
      );
      await query(
        'UPDATE promo_codes SET uses_count = uses_count + 1, updated_at = now() WHERE id = $1',
        [promoCodeId]
      );
    }

    res.json({
      payment_url: payment.confirmation?.confirmation_url,
      order_id: orderResult.rows[0].id,
      payment_id: payment.id,
      discount_applied: discountAmount > 0,
      discount_amount: discountAmount,
      original_amount: originalAmount,
      final_amount: amount,
    });
  } catch (error) {
    logger.error('Create payment error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// POST /api/payments/webhook — YooKassa webhook (public, verified by secret)
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;

    if (!event || event.type !== 'payment.succeeded') {
      return res.json({ ok: true });
    }

    const payment = event.object;
    const yookassaPaymentId = payment?.id;
    const metadata = payment?.metadata || {};
    const courseId = metadata.course_id;
    const userId = metadata.user_id;

    if (!yookassaPaymentId || !courseId || !userId) {
      logger.warn('Webhook missing required fields:', { yookassaPaymentId, courseId, userId });
      return res.json({ ok: true });
    }

    const orderResult = await query(
      "UPDATE orders SET status = 'succeeded', updated_at = now() WHERE yookassa_payment_id = $1 AND status = 'pending' RETURNING id, course_id, user_id",
      [yookassaPaymentId]
    );

    if (orderResult.rows.length === 0) {
      return res.json({ ok: true });
    }

    // Find student db row
    const userResult = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      logger.warn('Webhook: user not found', { userId });
      return res.json({ ok: true });
    }

    const existing = await query(
      'SELECT id FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
      [courseId, userId]
    );

    if (existing.rows.length === 0) {
      await query(`
        INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
        VALUES ($1, $2, $2, NULL)
      `, [courseId, userId]);

      logger.info(`Enrolled user ${userId} in course ${courseId} via payment ${yookassaPaymentId}`);
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// POST /api/payments/confirm/:courseId — called on return from YooKassa to sync enrollment
// Falls back to polling YooKassa directly if webhook hasn't arrived yet
router.post('/confirm/:courseId', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { courseId } = req.params;

    // Already enrolled?
    const enrolledCheck = await query(`
      SELECT ce.id FROM course_enrollments ce
      WHERE ce.course_id = $1 AND ce.student_id = $2
    `, [courseId, userId]);

    if (enrolledCheck.rows.length > 0) {
      return res.json({ enrolled: true });
    }

    // Find a succeeded order (webhook may have already updated it)
    const orderResult = await query(
      "SELECT id, yookassa_payment_id, status FROM orders WHERE course_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1",
      [courseId, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.json({ enrolled: false });
    }

    const order = orderResult.rows[0];

    // If order is succeeded but not yet enrolled — enroll now
    if (order.status === 'succeeded') {
      await query(`
        INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
        VALUES ($1, $2, $2, NULL)
        ON CONFLICT DO NOTHING
      `, [courseId, userId]);
      return res.json({ enrolled: true });
    }

    // Order still pending — ask YooKassa directly
    if (order.status === 'pending' && order.yookassa_payment_id && yookassaConfigured()) {
      const ykRes = await fetch(`https://api.yookassa.ru/v3/payments/${order.yookassa_payment_id}`, {
        headers: { 'Authorization': yookassaAuth() },
      });

      if (ykRes.ok) {
        const payment: any = await ykRes.json();
        if (payment.status === 'succeeded') {
          await query(
            "UPDATE orders SET status = 'succeeded', updated_at = now() WHERE id = $1",
            [order.id]
          );
          await query(`
            INSERT INTO course_enrollments (course_id, student_id, granted_by, expires_at)
            VALUES ($1, $2, $2, NULL)
            ON CONFLICT DO NOTHING
          `, [courseId, userId]);
          logger.info(`Confirm endpoint enrolled user ${userId} in course ${courseId}`);
          return res.json({ enrolled: true });
        }
      }
    }

    res.json({ enrolled: false });
  } catch (error) {
    logger.error('Confirm enrollment error:', error);
    res.status(500).json({ error: 'Failed to confirm enrollment' });
  }
});

// GET /api/payments/check/:courseId — check if user already purchased a course
router.get('/check/:courseId', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { courseId } = req.params;

    const enrolled = await query(`
      SELECT ce.id FROM course_enrollments ce
      JOIN users u ON ce.student_id = u.id
      WHERE ce.course_id = $1 AND u.id = $2
    `, [courseId, userId]);

    res.json({ enrolled: enrolled.rows.length > 0 });
  } catch (error) {
    logger.error('Check enrollment error:', error);
    res.status(500).json({ error: 'Failed to check enrollment' });
  }
});

// GET /api/payments/orders — seller's own orders
router.get('/orders', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(`
      SELECT o.id, o.amount, o.platform_fee, o.seller_amount, o.status,
        o.yookassa_payment_id, o.created_at, o.updated_at,
        json_build_object('id', c.id, 'title', c.title) as course,
        json_build_object(
          'id', u.id,
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username,
          'email', u.email
        ) as buyer
      FROM orders o
      JOIN courses c ON o.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      JOIN users u ON o.user_id = u.id
      WHERE s.user_id = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, parseInt(limit), offset]);

    const countResult = await query(`
      SELECT COUNT(*) FROM orders o
      JOIN courses c ON o.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE s.user_id = $1
    `, [userId]);

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error('Get seller orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/payments/orders/stats — seller sales stats
router.get('/orders/stats', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE o.status = 'succeeded') as total_sales,
        COALESCE(SUM(o.seller_amount) FILTER (WHERE o.status = 'succeeded'), 0) as total_revenue,
        COALESCE(SUM(o.platform_fee) FILTER (WHERE o.status = 'succeeded'), 0) as total_fees,
        COUNT(*) FILTER (WHERE o.status = 'pending') as pending_count,
        COUNT(DISTINCT o.course_id) FILTER (WHERE o.status = 'succeeded') as courses_sold,
        json_agg(
          json_build_object(
            'month', to_char(date_trunc('month', o.created_at), 'YYYY-MM'),
            'sales', COUNT(*) FILTER (WHERE o.status = 'succeeded'),
            'revenue', COALESCE(SUM(o.seller_amount) FILTER (WHERE o.status = 'succeeded'), 0)
          ) ORDER BY date_trunc('month', o.created_at)
        ) FILTER (WHERE o.created_at >= now() - interval '6 months') as monthly
      FROM orders o
      JOIN courses c ON o.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      WHERE s.user_id = $1
    `, [userId]);

    const byCourse = await query(`
      SELECT c.id, c.title,
        COUNT(*) FILTER (WHERE o.status = 'succeeded') as sales,
        COALESCE(SUM(o.seller_amount) FILTER (WHERE o.status = 'succeeded'), 0) as revenue
      FROM courses c
      JOIN sellers s ON c.seller_id = s.id
      LEFT JOIN orders o ON o.course_id = c.id
      WHERE s.user_id = $1
      GROUP BY c.id, c.title
      ORDER BY revenue DESC
    `, [userId]);

    res.json({
      ...result.rows[0],
      by_course: byCourse.rows,
    });
  } catch (error) {
    logger.error('Get seller stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/payments/admin/orders — admin all orders
router.get('/admin/orders', async (req: AuthRequest, res) => {
  try {
    const userRoles: string[] = (req as any).user?.roles || [];
    if (!userRoles.includes('super_admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { page = '1', limit = '50', status } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const statusFilter = status ? `AND o.status = '${status}'` : '';

    const result = await query(`
      SELECT o.id, o.amount, o.platform_fee, o.seller_amount, o.status,
        o.yookassa_payment_id, o.created_at, o.updated_at,
        json_build_object('id', c.id, 'title', c.title) as course,
        json_build_object('id', s.id, 'business_name', s.business_name) as seller,
        json_build_object(
          'id', u.id,
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username,
          'email', u.email
        ) as buyer
      FROM orders o
      JOIN courses c ON o.course_id = c.id
      JOIN sellers s ON c.seller_id = s.id
      JOIN users u ON o.user_id = u.id
      WHERE 1=1 ${statusFilter}
      ORDER BY o.created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);

    const countResult = await query(
      `SELECT COUNT(*) FROM orders o WHERE 1=1 ${statusFilter}`
    );

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error('Get admin orders error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/payments/admin/stats — admin platform-wide payment stats
router.get('/admin/stats', async (req: AuthRequest, res) => {
  try {
    const userRoles: string[] = (req as any).user?.roles || [];
    if (!userRoles.includes('super_admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'succeeded') as total_sales,
        COALESCE(SUM(amount) FILTER (WHERE status = 'succeeded'), 0) as total_gmv,
        COALESCE(SUM(platform_fee) FILTER (WHERE status = 'succeeded'), 0) as total_platform_revenue,
        COALESCE(SUM(seller_amount) FILTER (WHERE status = 'succeeded'), 0) as total_seller_payouts,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'canceled') as canceled_count,
        COUNT(DISTINCT user_id) FILTER (WHERE status = 'succeeded') as unique_buyers,
        COUNT(DISTINCT course_id) FILTER (WHERE status = 'succeeded') as courses_with_sales
      FROM orders
    `);

    const monthly = await query(`
      SELECT
        to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
        COUNT(*) FILTER (WHERE status = 'succeeded') as sales,
        COALESCE(SUM(amount) FILTER (WHERE status = 'succeeded'), 0) as gmv,
        COALESCE(SUM(platform_fee) FILTER (WHERE status = 'succeeded'), 0) as platform_revenue
      FROM orders
      WHERE created_at >= now() - interval '12 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `);

    const topSellers = await query(`
      SELECT s.id, s.business_name,
        COUNT(*) FILTER (WHERE o.status = 'succeeded') as sales,
        COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'succeeded'), 0) as gmv,
        COALESCE(SUM(o.platform_fee) FILTER (WHERE o.status = 'succeeded'), 0) as platform_fee
      FROM sellers s
      LEFT JOIN courses c ON c.seller_id = s.id
      LEFT JOIN orders o ON o.course_id = c.id
      GROUP BY s.id, s.business_name
      ORDER BY gmv DESC
      LIMIT 10
    `);

    res.json({
      ...result.rows[0],
      monthly: monthly.rows,
      top_sellers: topSellers.rows,
    });
  } catch (error) {
    logger.error('Get admin payment stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── BALANCE ────────────────────────────────────────────────────────────────

// GET /api/payments/balance — seller's available balance (earned - withdrawn)
router.get('/balance', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    // Total earned from succeeded orders
    const earnedResult = await query(`
      SELECT COALESCE(SUM(o.seller_amount), 0) as earned
      FROM orders o
      JOIN courses c ON o.course_id = c.id
      WHERE c.seller_id = $1 AND o.status = 'succeeded'
    `, [sellerId]);

    // Total requested to withdraw (pending + approved + paid)
    const withdrawnResult = await query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'approved')), 0) as reserved,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_out
      FROM withdrawal_requests
      WHERE seller_id = $1
    `, [sellerId]);

    const earned = parseInt(earnedResult.rows[0].earned);
    const reserved = parseInt(withdrawnResult.rows[0].reserved);
    const paidOut = parseInt(withdrawnResult.rows[0].paid_out);
    const available = earned - reserved - paidOut;

    res.json({
      earned,
      paid_out: paidOut,
      reserved,
      available: Math.max(0, available),
    });
  } catch (error) {
    logger.error('Get balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ─── WITHDRAWALS ─────────────────────────────────────────────────────────────

// GET /api/payments/withdrawals — seller's withdrawal requests
router.get('/withdrawals', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;

    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    const result = await query(`
      SELECT id, amount, status, payment_details, admin_note, created_at, updated_at
      FROM withdrawal_requests
      WHERE seller_id = $1
      ORDER BY created_at DESC
    `, [sellerId]);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get withdrawals error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// POST /api/payments/withdrawals — seller submits withdrawal request
router.post('/withdrawals', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { amount, payment_details } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const sellerResult = await query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
    if (sellerResult.rows.length === 0) {
      return res.status(403).json({ error: 'Seller not found' });
    }
    const sellerId = sellerResult.rows[0].id;

    // Calculate available balance
    const earnedResult = await query(`
      SELECT COALESCE(SUM(o.seller_amount), 0) as earned
      FROM orders o
      JOIN courses c ON o.course_id = c.id
      WHERE c.seller_id = $1 AND o.status = 'succeeded'
    `, [sellerId]);

    const withdrawnResult = await query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'approved')), 0) as reserved,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_out
      FROM withdrawal_requests
      WHERE seller_id = $1
    `, [sellerId]);

    const earned = parseInt(earnedResult.rows[0].earned);
    const reserved = parseInt(withdrawnResult.rows[0].reserved);
    const paidOut = parseInt(withdrawnResult.rows[0].paid_out);
    const available = Math.max(0, earned - reserved - paidOut);

    if (amount > available) {
      return res.status(400).json({ error: `Недостаточно средств. Доступно: ${available} коп.` });
    }

    // Check no pending request already
    const pendingCheck = await query(
      "SELECT id FROM withdrawal_requests WHERE seller_id = $1 AND status = 'pending'",
      [sellerId]
    );
    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({ error: 'У вас уже есть заявка на рассмотрении' });
    }

    const result = await query(`
      INSERT INTO withdrawal_requests (seller_id, amount, status, payment_details)
      VALUES ($1, $2, 'pending', $3)
      RETURNING *
    `, [sellerId, amount, JSON.stringify(payment_details || {})]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create withdrawal error:', error);
    res.status(500).json({ error: 'Failed to create withdrawal request' });
  }
});

// GET /api/payments/admin/withdrawals — admin: list all withdrawal requests
router.get('/admin/withdrawals', async (req: AuthRequest, res) => {
  try {
    const userRoles: string[] = (req as any).user?.roles || [];
    if (!userRoles.includes('super_admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { status } = req.query as Record<string, string>;
    const statusFilter = status ? `AND wr.status = '${status}'` : '';

    const result = await query(`
      SELECT wr.id, wr.amount, wr.status, wr.payment_details, wr.admin_note,
        wr.created_at, wr.updated_at,
        json_build_object(
          'id', s.id,
          'business_name', s.business_name
        ) as seller,
        json_build_object(
          'id', u.id,
          'first_name', u.first_name,
          'last_name', u.last_name,
          'telegram_username', u.telegram_username,
          'email', u.email
        ) as user
      FROM withdrawal_requests wr
      JOIN sellers s ON wr.seller_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE 1=1 ${statusFilter}
      ORDER BY wr.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    logger.error('Get admin withdrawals error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// PATCH /api/payments/admin/withdrawals/:id — admin: approve / reject / mark paid
router.patch('/admin/withdrawals/:id', async (req: AuthRequest, res) => {
  try {
    const userRoles: string[] = (req as any).user?.roles || [];
    if (!userRoles.includes('super_admin')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const { status, admin_note } = req.body;

    if (!['approved', 'rejected', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await query(`
      UPDATE withdrawal_requests
      SET status = $1, admin_note = $2, updated_at = now()
      WHERE id = $3
      RETURNING *
    `, [status, admin_note || null, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update withdrawal error:', error);
    res.status(500).json({ error: 'Failed to update withdrawal' });
  }
});

export default router;

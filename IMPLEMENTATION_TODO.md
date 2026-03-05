# Backend Implementation TODO

This checklist tracks all files that need to be implemented for a complete backend.

## Status Legend
- ✅ Complete - File created and ready
- 🔨 In Progress - Partial implementation provided
- ⏳ TODO - Needs to be implemented

---

## Core Files

- [✅] `package.json` - Dependencies and scripts
- [✅] `tsconfig.json` - TypeScript configuration
- [✅] `.env.example` - Environment variables template
- [✅] `Dockerfile` - Docker build configuration
- [✅] `docker-compose.yml` - Multi-container setup
- [✅] `.dockerignore` - Docker ignore patterns
- [✅] `.gitignore` - Git ignore patterns
- [✅] `README.md` - Project documentation
- [✅] `IMPLEMENTATION_GUIDE.md` - Detailed implementation guide
- [⏳] `eslint.config.js` - ESLint configuration

---

## Utils (src/utils/)

- [✅] `db.ts` - PostgreSQL connection pool
- [✅] `logger.ts` - Winston logger setup
- [✅] `jwt.ts` - JWT token utilities
- [⏳] `crypto.ts` - Hashing and encryption utilities

**crypto.ts implementation**:
```typescript
import crypto from 'crypto';
import bcrypt from 'bcrypt';

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
```

---

## Services (src/services/)

- [🔨] `authService.ts` - Authentication logic (partial)
- [🔨] `s3Service.ts` - S3 operations (complete)
- [🔨] `telegramService.ts` - Telegram webhook (complete)
- [⏳] `mediaService.ts` - Media processing helpers

**mediaService.ts needed features**:
- Extract video thumbnails
- Validate file types
- Resize images
- Generate media access tokens
- Media metadata extraction

---

## Middleware (src/middleware/)

- [🔨] `auth.ts` - JWT authentication (partial)
- [🔨] `errorHandler.ts` - Global error handling (complete)
- [⏳] `validators.ts` - Request validation with Zod

**validators.ts example**:
```typescript
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const createCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().min(0),
});

export function validateRequest(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      res.status(400).json({ error: 'Validation failed', details: error });
    }
  };
}
```

---

## Routes (src/routes/)

### Authentication Routes (src/routes/auth.ts)

- [⏳] `POST /api/auth/telegram` - Telegram OAuth
- [⏳] `GET /api/auth/oauth/vk` - VK OAuth init
- [⏳] `GET /api/auth/oauth/vk/callback` - VK callback
- [⏳] `GET /api/auth/oauth/yandex` - Yandex OAuth init
- [⏳] `GET /api/auth/oauth/yandex/callback` - Yandex callback
- [⏳] `POST /api/auth/logout` - Logout
- [⏳] `GET /api/auth/me` - Get current user

**Endpoints to implement**:
```typescript
router.post('/telegram', async (req, res) => {
  // Verify Telegram auth data
  // Find or create user
  // Generate JWT token
  // Return user + token
});

router.get('/me', authenticate, async (req, res) => {
  // Get user by ID
  // Get user roles
  // Return user data
});
```

### Course Routes (src/routes/courses.ts)

- [⏳] `GET /api/courses` - List courses
- [⏳] `GET /api/courses/:id` - Get course
- [⏳] `POST /api/courses` - Create course
- [⏳] `PUT /api/courses/:id` - Update course
- [⏳] `DELETE /api/courses/:id` - Delete course
- [⏳] `GET /api/courses/:id/posts` - Get posts
- [⏳] `POST /api/courses/:id/posts` - Create post
- [⏳] `PUT /api/courses/:id/posts/:postId` - Update post
- [⏳] `DELETE /api/courses/:id/posts/:postId` - Delete post

### Enrollment Routes (src/routes/enrollments.ts)

- [⏳] `GET /api/student/enrollments` - My enrollments
- [⏳] `POST /api/courses/:id/enroll` - Enroll in course
- [⏳] `GET /api/seller/courses/:id/pending` - Pending enrollments
- [⏳] `POST /api/seller/enrollments/:id/approve` - Approve
- [⏳] `POST /api/seller/enrollments/:id/reject` - Reject

### Seller Routes (src/routes/seller.ts)

- [⏳] `GET /api/seller/courses` - My courses
- [⏳] `GET /api/seller/bots` - My bots
- [⏳] `POST /api/seller/bots` - Create bot
- [⏳] `PUT /api/seller/bots/:id` - Update bot
- [⏳] `DELETE /api/seller/bots/:id` - Delete bot
- [⏳] `GET /api/seller/stats` - Statistics

### Admin Routes (src/routes/admin.ts)

- [⏳] `GET /api/admin/users` - List users
- [⏳] `GET /api/admin/courses` - List courses
- [⏳] `GET /api/admin/stats` - Platform stats
- [⏳] `POST /api/admin/courses/:id/premium` - Toggle premium
- [⏳] `POST /api/admin/courses/:id/featured` - Toggle featured
- [⏳] `POST /api/admin/link` - Generate admin link

### Media Routes (src/routes/media.ts)

- [🔨] `GET /api/media/:path` - Stream media (complete)
- [🔨] `POST /api/media/upload` - Upload file (complete)
- [⏳] `POST /api/media/token` - Generate access token

### Telegram Routes (src/routes/telegram.ts)

- [🔨] `POST /api/telegram/webhook/:botId` - Webhook (complete)
- [⏳] `POST /api/telegram/register-webhook` - Register webhook

---

## Types (src/types/)

- [⏳] `index.ts` - TypeScript type definitions

**Required types**:
```typescript
export interface User {
  id: string;
  telegram_id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  created_at: Date;
}

export interface Course {
  id: string;
  seller_id: string;
  title: string;
  description?: string;
  price: number;
  telegram_chat_id?: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CoursePost {
  id: string;
  course_id: string;
  message_text?: string;
  telegram_message_id?: number;
  is_pinned: boolean;
  created_at: Date;
}

export interface CoursePostMedia {
  id: string;
  post_id: string;
  media_type: 'photo' | 'video' | 'document' | 'voice' | 'media_group';
  s3_url: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  thumbnail_s3_url?: string;
  media_group_id?: string;
  duration_seconds?: number;
}

// Add all other table types...
```

---

## Core Server Files

- [🔨] `src/index.ts` - Entry point (provided in guide)
- [🔨] `src/server.ts` - Express app setup (provided in guide)

---

## Database Migrations

The database schema already exists in the Supabase migrations. No new migrations needed unless schema changes are required.

---

## Testing

- [⏳] `src/__tests__/auth.test.ts` - Auth tests
- [⏳] `src/__tests__/courses.test.ts` - Course tests
- [⏳] `src/__tests__/telegram.test.ts` - Telegram tests
- [⏳] `jest.config.js` - Jest configuration

---

## Documentation

- [✅] `README.md` - Main documentation
- [✅] `IMPLEMENTATION_GUIDE.md` - Implementation guide
- [⏳] `API.md` - API documentation
- [⏳] `DEPLOYMENT.md` - Deployment guide

---

## Deployment

- [⏳] `.github/workflows/deploy.yml` - CI/CD pipeline
- [⏳] `nginx.conf` - Nginx reverse proxy config
- [⏳] `pm2.config.js` - PM2 process manager config

---

## Priority Implementation Order

### Phase 1: Core Foundation (Must Have)
1. ✅ Database connection (`utils/db.ts`)
2. ✅ Logger (`utils/logger.ts`)
3. ✅ JWT utilities (`utils/jwt.ts`)
4. ⏳ Crypto utilities (`utils/crypto.ts`)
5. ⏳ Error handler middleware (complete)
6. ⏳ Auth middleware (complete)
7. ⏳ Server setup (provided)
8. ⏳ Entry point (provided)

### Phase 2: Authentication (Critical)
9. ⏳ Auth service (partial - needs completion)
10. ⏳ Auth routes
11. ⏳ OAuth integration (VK, Yandex)

### Phase 3: Core API (High Priority)
12. ⏳ Course routes (all endpoints)
13. ⏳ Enrollment routes
14. ⏳ Seller routes

### Phase 4: Media & Telegram (High Priority)
15. ✅ S3 service (complete)
16. ✅ Telegram service (complete)
17. ✅ Media routes (complete)
18. ✅ Telegram webhook (complete)

### Phase 5: Admin Features (Medium Priority)
19. ⏳ Admin routes
20. ⏳ Admin authentication

### Phase 6: Polish (Low Priority)
21. ⏳ Request validators
22. ⏳ Type definitions
23. ⏳ Tests
24. ⏳ API documentation

---

## Estimated Effort

- **Total Files**: ~25 files
- **Total Lines of Code**: ~5,000-6,000 lines
- **Estimated Time**: 3-5 days for experienced developer

---

## Quick Start Implementation

To get a minimal working backend:

1. Implement `src/routes/auth.ts` (Telegram auth only)
2. Implement `src/routes/courses.ts` (basic CRUD)
3. Use provided Telegram webhook
4. Use provided media routes
5. Test with frontend

This gives you:
- Login functionality
- Course viewing
- Media display
- Telegram integration

Then expand from there.

---

## Notes

- All database queries should use parameterized queries (SQL injection protection)
- All routes should include proper error handling
- Use transactions for multi-step operations
- Log all errors with context
- Validate all user input
- Check authorization on all protected routes
- Use TypeScript strict mode
- Add JSDoc comments to public functions

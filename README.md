# KeyKurs Backend API

Express.js + TypeScript backend for the KeyKurs online course platform.

## Architecture

- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL (via pg driver with connection pooling)
- **Authentication**: JWT tokens (replacing Supabase Auth)
- **File Storage**: Timeweb S3 (AWS SDK v3)
- **Media Handling**: Direct Telegram file download → S3 upload
- **API**: RESTful endpoints matching frontend expectations

## Features

- JWT-based authentication (Telegram, VK, Yandex OAuth)
- Complete CRUD operations for all 14 database tables
- S3 media storage with streaming support
- Telegram webhook with automatic media download to S3
- Media group buffering and batch processing
- Role-based access control (admin, seller, student)
- File upload handling (browser → S3)
- Video streaming with Range request support
- Rate limiting and security headers

## Project Structure

```
src/
├── index.ts                 # Application entry point
├── server.ts                # Express server setup
├── routes/
│   ├── auth.ts             # Authentication routes
│   ├── courses.ts          # Course CRUD
│   ├── posts.ts            # Course posts CRUD
│   ├── enrollments.ts      # Enrollment management
│   ├── seller.ts           # Seller-specific routes
│   ├── admin.ts            # Admin routes
│   ├── media.ts            # Media streaming/upload
│   └── telegram.ts         # Telegram webhook
├── middleware/
│   ├── auth.ts             # JWT verification
│   ├── rbac.ts             # Role-based access control
│   ├── errorHandler.ts     # Global error handling
│   └── validators.ts       # Request validation
├── services/
│   ├── authService.ts      # Authentication logic
│   ├── telegramService.ts  # Telegram API interactions
│   ├── s3Service.ts        # S3 upload/download
│   └── mediaService.ts     # Media processing
├── utils/
│   ├── db.ts               # Database connection pool
│   ├── logger.ts           # Winston logger
│   ├── jwt.ts              # JWT utilities
│   └── crypto.ts           # Hashing/encryption
└── types/
    └── index.ts            # TypeScript type definitions
```

## Environment Variables

See `.env.example` for all required variables:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for signing JWT tokens
- `S3_*` - Timeweb S3 credentials and configuration
- `VK_*`, `YANDEX_*` - OAuth provider credentials
- `FRONTEND_URL` - For CORS configuration

## API Endpoints

### Authentication
- `POST /api/auth/telegram` - Telegram login (HMAC-SHA256 verification)
- `GET /api/auth/oauth/vk` - VK OAuth initiation
- `GET /api/auth/oauth/vk/callback` - VK OAuth callback
- `GET /api/auth/oauth/yandex` - Yandex OAuth initiation
- `GET /api/auth/oauth/yandex/callback` - Yandex OAuth callback
- `POST /api/auth/logout` - Logout (token invalidation)
- `GET /api/auth/me` - Get current user + roles

### Courses
- `GET /api/courses` - List courses (public + enrolled)
- `GET /api/courses/:id` - Get course details
- `POST /api/courses` - Create course (seller)
- `PUT /api/courses/:id` - Update course (seller)
- `DELETE /api/courses/:id` - Delete course (seller)
- `GET /api/courses/:id/posts` - Get course posts + media
- `POST /api/courses/:id/posts` - Create post (seller)
- `PUT /api/courses/:id/posts/:postId` - Update post (seller)
- `DELETE /api/courses/:id/posts/:postId` - Delete post (seller)

### Enrollments
- `GET /api/student/enrollments` - My enrollments
- `POST /api/courses/:id/enroll` - Enroll in course
- `GET /api/seller/courses/:id/pending` - Pending enrollments (seller)
- `POST /api/seller/enrollments/:id/approve` - Approve (seller)
- `POST /api/seller/enrollments/:id/reject` - Reject (seller)

### Seller
- `GET /api/seller/courses` - My courses
- `GET /api/seller/bots` - My bots
- `POST /api/seller/bots` - Create bot
- `PUT /api/seller/bots/:id` - Update bot
- `DELETE /api/seller/bots/:id` - Delete bot
- `GET /api/seller/stats` - Seller statistics

### Admin
- `GET /api/admin/users` - List all users
- `GET /api/admin/courses` - List all courses
- `GET /api/admin/stats` - Platform statistics
- `POST /api/admin/courses/:id/premium` - Toggle premium
- `POST /api/admin/courses/:id/featured` - Toggle featured
- `POST /api/admin/link` - Generate admin link

### Media
- `GET /api/media/:path` - Stream media from S3 (Range support)
- `POST /api/media/upload` - Upload file (browser → S3)
- `POST /api/media/token` - Generate media access token

### Telegram
- `POST /api/telegram/webhook/:botId` - Telegram webhook endpoint
- `POST /api/telegram/register-webhook` - Register webhook URL

## Database Schema

Using existing PostgreSQL database with 14 tables:
- `users` - User accounts
- `user_roles` - User role assignments
- `sellers` - Seller profiles
- `courses` - Course catalog
- `course_enrollments` - Student enrollments
- `pending_enrollments` - Pending enrollment requests
- `course_posts` - Course content posts
- `course_post_media` - Media attachments
- `student_pinned_posts` - Pinned posts per student
- `telegram_bots` - Bot configurations
- `telegram_media_group_buffer` - Temporary media group buffer
- `media_access_tokens` - Temporary media access tokens
- `pkce_sessions` - OAuth PKCE sessions
- `ads_posts` / `featured_courses` / `premium_courses` - Admin features

## Media Flow

### Telegram → S3
1. Webhook receives message with media
2. Extract `file_id` from Telegram message
3. Call `https://api.telegram.org/bot{token}/getFile?file_id={file_id}`
4. Download from `https://api.telegram.org/file/bot{token}/{file_path}`
5. Upload to Timeweb S3
6. Store S3 path in `course_post_media.s3_url`
7. Delete `telegram_file_id` (no longer needed)

### Media Groups
1. Buffer messages with `media_group_id` for 5 seconds
2. Download all files in group
3. Upload all to S3
4. Create single `course_post` with multiple `course_post_media` entries

### Browser → S3
1. Client uploads via `POST /api/media/upload`
2. Multer receives file
3. Upload to S3
4. Return S3 URL to client

### S3 → Client (Streaming)
1. Client requests `GET /api/media/:path`
2. Server proxies from S3 with Range header support
3. Enables video seeking and progressive download

## Development

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Run in development mode
npm run dev

# Type check
npm run typecheck

# Build for production
npm run build

# Run production build
npm start
```

## Docker

```bash
# Build
docker build -t keykurs-backend .

# Run
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  keykurs-backend
```

## Security

- JWT tokens with configurable expiration
- HMAC-SHA256 verification for Telegram auth
- PKCE flow for OAuth providers
- Rate limiting on all endpoints
- Helmet.js security headers
- CORS configuration
- SQL injection prevention (parameterized queries)
- File type validation
- File size limits

## Error Handling

All errors return consistent JSON format:
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad request
- 401: Unauthorized
- 403: Forbidden
- 404: Not found
- 500: Internal server error

## Logging

Winston logger with levels:
- `error` - Errors and exceptions
- `warn` - Warnings
- `info` - General information
- `debug` - Detailed debug information

## Testing

```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong `JWT_SECRET`
3. Configure PostgreSQL connection pooling
4. Setup S3 bucket with proper CORS
5. Enable HTTPS
6. Configure rate limiting
7. Setup log aggregation
8. Monitor error rates

## License

Proprietary

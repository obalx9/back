-- ============================================================================
-- KeyKurs Platform - Complete Database Schema for Timeweb Cloud PostgreSQL
-- ============================================================================
-- This schema is built to match the actual backend routes and queries.
-- It consolidates all Supabase migrations into a single clean file.
--
-- Tables: 26
-- Functions: 8
-- Triggers: 5
-- Extensions: pgcrypto, uuid-ossp
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id       bigint      UNIQUE,
  telegram_username text,
  first_name        text,
  last_name         text,
  photo_url         text,
  email             text,
  oauth_provider    text        DEFAULT 'telegram' CHECK (oauth_provider IN ('telegram', 'vk', 'yandex')),
  oauth_id          text,
  user_id           text        UNIQUE DEFAULT (LEFT(MD5(gen_random_uuid()::text), 12)),
  created_at        timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_id_idx
  ON users (oauth_provider, oauth_id)
  WHERE oauth_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('super_admin', 'seller', 'student')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS sellers (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name      text        NOT NULL,
  description        text        DEFAULT '',
  is_approved        boolean     DEFAULT false,
  premium_active     boolean     NOT NULL DEFAULT false,
  premium_expires_at timestamptz,
  created_at         timestamptz DEFAULT now()
);

-- ============================================================================
-- COURSE STRUCTURE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS courses (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           uuid        NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  title               text        NOT NULL,
  description         text        DEFAULT '',
  price               numeric     DEFAULT 0,
  thumbnail_url       text,
  telegram_chat_id    bigint,
  is_published        boolean     DEFAULT false,
  is_active           boolean     DEFAULT true,
  autoplay_videos     boolean     DEFAULT false,
  reverse_post_order  boolean     DEFAULT false,
  show_post_dates     boolean     DEFAULT false,
  show_lesson_numbers boolean     DEFAULT true,
  compact_view        boolean     DEFAULT false,
  allow_downloads     boolean     DEFAULT true,
  theme_preset        text        DEFAULT 'pure-light',
  theme_config        jsonb,
  watermark           text,
  display_settings    jsonb       DEFAULT '{}',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_modules (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       text    NOT NULL,
  description text    DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id        uuid    NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  title            text    NOT NULL,
  description      text    DEFAULT '',
  order_index      integer NOT NULL DEFAULT 0,
  duration_minutes integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_content (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    uuid    NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  content_type text    NOT NULL CHECK (content_type IN ('video', 'image', 'text', 'file')),
  video_url    text,
  text_content text,
  file_url     text,
  file_name    text,
  order_index  integer NOT NULL DEFAULT 0,
  storage_path text,
  file_size    bigint,
  created_at   timestamptz DEFAULT now()
);

-- ============================================================================
-- ENROLLMENT TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS course_enrollments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by  uuid        NOT NULL REFERENCES users(id),
  enrolled_at timestamptz DEFAULT now(),
  expires_at  timestamptz,
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS pending_enrollments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  telegram_id       text,
  telegram_username text,
  granted_by        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at        timestamptz,
  user_id_ref       text,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT pending_enrollments_identifier_check
    CHECK (telegram_id IS NOT NULL OR telegram_username IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id         uuid    NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id             uuid    NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  completed             boolean DEFAULT false,
  last_position_seconds integer DEFAULT 0,
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(enrollment_id, lesson_id)
);

-- ============================================================================
-- COURSE POSTS & MEDIA TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS course_posts (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id                  uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_type                text        NOT NULL DEFAULT 'manual' CHECK (source_type IN ('telegram', 'manual')),
  title                      text        DEFAULT '',
  text_content               text        DEFAULT '',
  message_text               text,
  media_type                 text        CHECK (media_type = ANY (ARRAY[
                                           'video','image','document','text','file',
                                           'photo','audio','animation','media_group','voice'
                                         ])),
  storage_path               text,
  file_name                  text,
  file_size                  bigint,
  telegram_file_id           text,
  telegram_message_id        bigint,
  telegram_media_width       integer,
  telegram_media_height      integer,
  telegram_media_duration    integer,
  telegram_thumbnail_file_id text,
  mime_type                  text,
  error_message              text,
  has_error                  boolean     DEFAULT false,
  is_pinned                  boolean     DEFAULT false,
  media_group_id             text,
  media_count                integer     DEFAULT 0,
  order_index                integer     DEFAULT 0,
  published_at               timestamptz DEFAULT now(),
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_post_media (
  id                         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                    uuid    NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  media_type                 text    CHECK (media_type = ANY (ARRAY[
                                       'video','image','document','photo','audio',
                                       'animation','voice','media_group'
                                     ])),
  telegram_file_id           text,
  telegram_thumbnail_file_id text,
  s3_url                     text,
  thumbnail_s3_url           text,
  storage_path               text,
  file_name                  text,
  file_size                  bigint,
  mime_type                  text,
  width                      integer,
  height                     integer,
  duration                   integer,
  duration_seconds           integer,
  order_index                integer DEFAULT 0,
  has_error                  boolean DEFAULT false,
  error_message              text,
  migration_error            text,
  media_group_id             text,
  created_at                 timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_pinned_posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid        REFERENCES users(id) ON DELETE CASCADE,
  user_id    uuid        REFERENCES users(id) ON DELETE CASCADE,
  course_id  uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  post_id    uuid        NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  pinned_at  timestamptz NOT NULL DEFAULT now(),
  notes      text,
  UNIQUE(user_id, post_id)
);

-- ============================================================================
-- TELEGRAM BOT TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS telegram_bots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      uuid        REFERENCES courses(id) ON DELETE CASCADE,
  seller_id      uuid        REFERENCES sellers(id) ON DELETE CASCADE,
  bot_token      text        NOT NULL,
  bot_username   text        NOT NULL,
  channel_id     text,
  webhook_secret text        NOT NULL DEFAULT gen_random_uuid()::text,
  webhook_url    text,
  is_active      boolean     DEFAULT false,
  bot_type       text        DEFAULT 'seller' CHECK (bot_type IN ('seller', 'import_service')),
  last_sync_at   timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_main_bot (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token      text        NOT NULL UNIQUE,
  bot_username   text        NOT NULL UNIQUE,
  webhook_secret text        NOT NULL DEFAULT (gen_random_uuid())::text,
  webhook_url    text,
  is_active      boolean     DEFAULT true,
  last_sync_at   timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_seller_chats (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_bot_id    uuid    NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  course_id        uuid    NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  telegram_chat_id bigint  NOT NULL,
  chat_title       text    NOT NULL DEFAULT '',
  chat_type        text    NOT NULL CHECK (chat_type IN ('private', 'group', 'supergroup', 'channel')),
  is_active        boolean DEFAULT true,
  last_message_id  bigint,
  last_sync_at     timestamptz,
  linked_at        timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE(seller_bot_id, telegram_chat_id, course_id)
);

CREATE TABLE IF NOT EXISTS telegram_linked_chats (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id     uuid    REFERENCES telegram_bots(id) ON DELETE CASCADE,
  course_id  uuid    REFERENCES courses(id) ON DELETE CASCADE,
  chat_id    bigint  NOT NULL,
  chat_title text,
  chat_type  text    NOT NULL DEFAULT 'channel',
  created_at timestamptz DEFAULT now(),
  linked_at  timestamptz DEFAULT now(),
  UNIQUE(chat_id)
);

CREATE TABLE IF NOT EXISTS telegram_media_group_buffer (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id           uuid,
  media_group_id      text        NOT NULL,
  telegram_message_id bigint      NOT NULL,
  file_id             text        NOT NULL DEFAULT '',
  media_type          text        NOT NULL DEFAULT 'photo',
  media_data          jsonb,
  caption             text,
  file_name           text,
  file_size           bigint,
  mime_type           text,
  message_text        text,
  message_date        timestamptz,
  received_at         timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_import_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint,
  platform_user_id uuid        REFERENCES users(id) ON DELETE CASCADE,
  course_id        uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  bot_id           uuid        REFERENCES telegram_bots(id) ON DELETE SET NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  status           text        DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  total_messages   integer     DEFAULT 0,
  message_count    integer     NOT NULL DEFAULT 0,
  error_message    text,
  started_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id           uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  telegram_message_id bigint      NOT NULL,
  message_date        timestamptz NOT NULL,
  content_type        text        NOT NULL CHECK (content_type IN ('text', 'photo', 'video', 'document', 'audio', 'animation')),
  text_content        text,
  caption             text,
  is_forwarded        boolean     DEFAULT false,
  forward_date        timestamptz,
  order_index         integer     DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  UNIQUE(course_id, telegram_message_id)
);

CREATE TABLE IF NOT EXISTS telegram_media (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        uuid    NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,
  media_type        text    NOT NULL CHECK (media_type IN ('photo', 'video', 'document', 'audio', 'animation')),
  file_id           text    NOT NULL,
  file_unique_id    text    NOT NULL,
  file_size         bigint,
  mime_type         text,
  file_name         text,
  thumbnail_file_id text,
  duration          integer,
  width             integer,
  height            integer,
  created_at        timestamptz DEFAULT now()
);

-- ============================================================================
-- MEDIA & OAUTH TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_access_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  uuid        REFERENCES courses(id) ON DELETE CASCADE,
  file_id    text,
  media_path text,
  token      text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'base64'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pkce_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  state         text        UNIQUE NOT NULL,
  code_verifier text        NOT NULL,
  redirect_url  text,
  created_at    timestamptz DEFAULT now(),
  expires_at    timestamptz DEFAULT (now() + interval '10 minutes')
);

-- ============================================================================
-- ADMIN FEATURE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS featured_courses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid        REFERENCES courses(id) ON DELETE SET NULL,
  order_index integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  title       text        NOT NULL DEFAULT '',
  description text        NOT NULL DEFAULT '',
  category    text        NOT NULL DEFAULT '',
  instructor  text        NOT NULL DEFAULT '',
  image_url   text        NOT NULL DEFAULT '',
  show_button boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_posts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text        NOT NULL DEFAULT '',
  text_content text        NOT NULL DEFAULT '',
  media_type   text,
  storage_path text,
  file_name    text,
  file_size    bigint,
  link_url     text,
  link_label   text        DEFAULT 'Подробнее',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_post_stats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_post_id uuid        NOT NULL REFERENCES ad_posts(id) ON DELETE CASCADE,
  event_type text        NOT NULL CHECK (event_type IN ('impression', 'click')),
  user_id    uuid        REFERENCES users(id),
  course_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ads_posts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL DEFAULT '',
  description text,
  image_url   text,
  target_url  text,
  impressions integer     DEFAULT 0,
  clicks      integer     DEFAULT 0,
  is_active   boolean     DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_courses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid        REFERENCES courses(id) ON DELETE CASCADE UNIQUE NOT NULL,
  enabled    boolean     DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text        NOT NULL DEFAULT '',
  value       text        NOT NULL DEFAULT '',
  icon        text        NOT NULL DEFAULT 'Mail',
  url         text,
  order_index int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_metrics (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text        NOT NULL DEFAULT '',
  value       text        NOT NULL DEFAULT '',
  icon        text        NOT NULL DEFAULT 'TrendingUp',
  order_index int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_oauth_id ON users(oauth_id);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider ON users(oauth_provider);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_sellers_user_id ON sellers(user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_premium_active ON sellers(premium_active);

CREATE INDEX IF NOT EXISTS idx_courses_seller_id ON courses(seller_id);
CREATE INDEX IF NOT EXISTS idx_courses_telegram_chat_id ON courses(telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_course_lessons_module_id ON course_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_lesson_content_lesson_id ON lesson_content(lesson_id);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_student_id ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course_id ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_granted_by ON course_enrollments(granted_by);

CREATE INDEX IF NOT EXISTS idx_pending_enrollments_course_id ON pending_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_telegram_id ON pending_enrollments(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_telegram_username ON pending_enrollments(telegram_username) WHERE telegram_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lesson_progress_enrollment_id ON lesson_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);

CREATE INDEX IF NOT EXISTS idx_course_posts_course_id ON course_posts(course_id);
CREATE INDEX IF NOT EXISTS idx_course_posts_published_at ON course_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_posts_order_index ON course_posts(order_index);
CREATE INDEX IF NOT EXISTS idx_course_posts_has_error ON course_posts(has_error) WHERE has_error = true;
CREATE INDEX IF NOT EXISTS idx_course_posts_source_type ON course_posts(source_type);
CREATE INDEX IF NOT EXISTS idx_course_posts_is_pinned ON course_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_course_posts_media_group_id ON course_posts(media_group_id) WHERE media_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_post_media_post_id ON course_post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_course_post_media_order ON course_post_media(post_id, order_index);
CREATE INDEX IF NOT EXISTS idx_course_post_media_media_group_id ON course_post_media(media_group_id);

CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_student_id ON student_pinned_posts(student_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_user_id ON student_pinned_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_course_id ON student_pinned_posts(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_post_id ON student_pinned_posts(post_id);

CREATE INDEX IF NOT EXISTS idx_telegram_bots_course_id ON telegram_bots(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_seller_id ON telegram_bots(seller_id);

CREATE INDEX IF NOT EXISTS idx_telegram_seller_chats_bot_id ON telegram_seller_chats(seller_bot_id);
CREATE INDEX IF NOT EXISTS idx_telegram_seller_chats_course_id ON telegram_seller_chats(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_seller_chats_chat_id ON telegram_seller_chats(telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_bot_id ON telegram_linked_chats(bot_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_course_id ON telegram_linked_chats(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_chat_id ON telegram_linked_chats(chat_id);

CREATE INDEX IF NOT EXISTS idx_telegram_media_group_buffer_group_id ON telegram_media_group_buffer(media_group_id);
CREATE INDEX IF NOT EXISTS idx_telegram_media_group_buffer_course_id ON telegram_media_group_buffer(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_media_group_buffer_received_at ON telegram_media_group_buffer(received_at);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_course_id ON telegram_messages(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_date ON telegram_messages(message_date DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_order ON telegram_messages(order_index);

CREATE INDEX IF NOT EXISTS idx_telegram_media_message_id ON telegram_media(message_id);

CREATE INDEX IF NOT EXISTS idx_import_sessions_course ON telegram_import_sessions(course_id);

CREATE INDEX IF NOT EXISTS idx_media_access_tokens_token ON media_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_expires ON media_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_user_id ON media_access_tokens(user_id);

CREATE INDEX IF NOT EXISTS pkce_sessions_state_idx ON pkce_sessions(state);
CREATE INDEX IF NOT EXISTS pkce_sessions_expires_at_idx ON pkce_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_featured_courses_order ON featured_courses(order_index) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ad_posts_is_active ON ad_posts(is_active);
CREATE INDEX IF NOT EXISTS idx_ad_post_stats_ad_post_id ON ad_post_stats(ad_post_id);
CREATE INDEX IF NOT EXISTS idx_ad_post_stats_event_type ON ad_post_stats(event_type);
CREATE INDEX IF NOT EXISTS idx_ad_post_stats_created_at ON ad_post_stats(created_at);

CREATE INDEX IF NOT EXISTS idx_ads_posts_is_active ON ads_posts(is_active);
CREATE INDEX IF NOT EXISTS idx_premium_courses_course_id ON premium_courses(course_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_super_admin(user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = user_uuid AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_seller(user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = user_uuid AND role = 'seller'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_seller_id(user_uuid uuid)
RETURNS uuid AS $$
BEGIN
  RETURN (SELECT id FROM sellers WHERE user_id = user_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_enrolled_in_course(user_uuid uuid, course_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM course_enrollments
    WHERE course_id = course_uuid AND student_id = user_uuid
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION owns_course(user_uuid uuid, course_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM courses
    WHERE id = course_uuid AND seller_id = get_seller_id(user_uuid)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_expired_media_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM media_access_tokens WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_old_media_group_buffer()
RETURNS void AS $$
BEGIN
  DELETE FROM telegram_media_group_buffer
  WHERE received_at < now() - interval '10 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_course_posts_updated_at ON course_posts;
CREATE TRIGGER update_course_posts_updated_at
  BEFORE UPDATE ON course_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_telegram_bots_updated_at ON telegram_bots;
CREATE TRIGGER update_telegram_bots_updated_at
  BEFORE UPDATE ON telegram_bots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ad_posts_updated_at ON ad_posts;
CREATE TRIGGER update_ad_posts_updated_at
  BEFORE UPDATE ON ad_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ads_posts_updated_at ON ads_posts;
CREATE TRIGGER update_ads_posts_updated_at
  BEFORE UPDATE ON ads_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_site_contacts_updated_at ON site_contacts;
CREATE TRIGGER update_site_contacts_updated_at
  BEFORE UPDATE ON site_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_site_metrics_updated_at ON site_metrics;
CREATE TRIGGER update_site_metrics_updated_at
  BEFORE UPDATE ON site_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY - DISABLED (auth handled by backend JWT middleware)
-- ============================================================================

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_modules DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons DISABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_post_media DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_pinned_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_bots DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_main_bot DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_seller_chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_linked_chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_media_group_buffer DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_import_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_media DISABLE ROW LEVEL SECURITY;
ALTER TABLE media_access_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE pkce_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE featured_courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE ad_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE ad_post_stats DISABLE ROW LEVEL SECURITY;
ALTER TABLE ads_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE premium_courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE site_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE site_metrics DISABLE ROW LEVEL SECURITY;

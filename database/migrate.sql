-- ============================================================================
-- KeyKurs Platform - Incremental Migration / Patch
-- ============================================================================
-- Run this file against an EXISTING Timeweb PostgreSQL database to bring it
-- in sync with the full schema.sql without dropping any data.
--
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- NEW TABLES (safe to create if they don't exist yet)
-- ============================================================================

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

CREATE TABLE IF NOT EXISTS premium_courses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid        REFERENCES courses(id) ON DELETE CASCADE UNIQUE NOT NULL,
  enabled    boolean     DEFAULT true,
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

CREATE TABLE IF NOT EXISTS ad_post_stats (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_post_id uuid        NOT NULL REFERENCES ad_posts(id) ON DELETE CASCADE,
  event_type text        NOT NULL CHECK (event_type IN ('impression', 'click')),
  user_id    uuid        REFERENCES users(id),
  course_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- MISSING COLUMNS IN EXISTING TABLES
-- ============================================================================

-- users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='oauth_id') THEN
    ALTER TABLE users ADD COLUMN oauth_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='oauth_provider') THEN
    ALTER TABLE users ADD COLUMN oauth_provider text DEFAULT 'telegram';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN
    ALTER TABLE users ADD COLUMN email text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='user_id') THEN
    ALTER TABLE users ADD COLUMN user_id text UNIQUE DEFAULT (LEFT(MD5(gen_random_uuid()::text), 12));
  END IF;
END $$;

-- sellers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sellers' AND column_name='premium_active') THEN
    ALTER TABLE sellers ADD COLUMN premium_active boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sellers' AND column_name='premium_expires_at') THEN
    ALTER TABLE sellers ADD COLUMN premium_expires_at timestamptz;
  END IF;
END $$;

-- courses
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='price') THEN
    ALTER TABLE courses ADD COLUMN price numeric DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='telegram_chat_id') THEN
    ALTER TABLE courses ADD COLUMN telegram_chat_id bigint;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='is_active') THEN
    ALTER TABLE courses ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='autoplay_videos') THEN
    ALTER TABLE courses ADD COLUMN autoplay_videos boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='reverse_post_order') THEN
    ALTER TABLE courses ADD COLUMN reverse_post_order boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='show_post_dates') THEN
    ALTER TABLE courses ADD COLUMN show_post_dates boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='show_lesson_numbers') THEN
    ALTER TABLE courses ADD COLUMN show_lesson_numbers boolean DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='compact_view') THEN
    ALTER TABLE courses ADD COLUMN compact_view boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='allow_downloads') THEN
    ALTER TABLE courses ADD COLUMN allow_downloads boolean DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='theme_preset') THEN
    ALTER TABLE courses ADD COLUMN theme_preset text DEFAULT 'pure-light';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='theme_config') THEN
    ALTER TABLE courses ADD COLUMN theme_config jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='watermark') THEN
    ALTER TABLE courses ADD COLUMN watermark text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='courses' AND column_name='display_settings') THEN
    ALTER TABLE courses ADD COLUMN display_settings jsonb DEFAULT '{}';
  END IF;
END $$;

-- lesson_content
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lesson_content' AND column_name='storage_path') THEN
    ALTER TABLE lesson_content ADD COLUMN storage_path text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lesson_content' AND column_name='file_size') THEN
    ALTER TABLE lesson_content ADD COLUMN file_size bigint;
  END IF;
END $$;

-- course_posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='source_type') THEN
    ALTER TABLE course_posts ADD COLUMN source_type text NOT NULL DEFAULT 'manual';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='title') THEN
    ALTER TABLE course_posts ADD COLUMN title text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='text_content') THEN
    ALTER TABLE course_posts ADD COLUMN text_content text DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='message_text') THEN
    ALTER TABLE course_posts ADD COLUMN message_text text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='media_type') THEN
    ALTER TABLE course_posts ADD COLUMN media_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='storage_path') THEN
    ALTER TABLE course_posts ADD COLUMN storage_path text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='file_name') THEN
    ALTER TABLE course_posts ADD COLUMN file_name text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='file_size') THEN
    ALTER TABLE course_posts ADD COLUMN file_size bigint;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_file_id') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_file_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_message_id') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_message_id bigint;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_media_width') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_media_width integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_media_height') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_media_height integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_media_duration') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_media_duration integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='telegram_thumbnail_file_id') THEN
    ALTER TABLE course_posts ADD COLUMN telegram_thumbnail_file_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='mime_type') THEN
    ALTER TABLE course_posts ADD COLUMN mime_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='error_message') THEN
    ALTER TABLE course_posts ADD COLUMN error_message text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='has_error') THEN
    ALTER TABLE course_posts ADD COLUMN has_error boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='is_pinned') THEN
    ALTER TABLE course_posts ADD COLUMN is_pinned boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='media_group_id') THEN
    ALTER TABLE course_posts ADD COLUMN media_group_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='media_count') THEN
    ALTER TABLE course_posts ADD COLUMN media_count integer DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='order_index') THEN
    ALTER TABLE course_posts ADD COLUMN order_index integer DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='published_at') THEN
    ALTER TABLE course_posts ADD COLUMN published_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_posts' AND column_name='updated_at') THEN
    ALTER TABLE course_posts ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- course_post_media
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='telegram_file_id') THEN
    ALTER TABLE course_post_media ADD COLUMN telegram_file_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='telegram_thumbnail_file_id') THEN
    ALTER TABLE course_post_media ADD COLUMN telegram_thumbnail_file_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='s3_url') THEN
    ALTER TABLE course_post_media ADD COLUMN s3_url text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='thumbnail_s3_url') THEN
    ALTER TABLE course_post_media ADD COLUMN thumbnail_s3_url text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='storage_path') THEN
    ALTER TABLE course_post_media ADD COLUMN storage_path text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='width') THEN
    ALTER TABLE course_post_media ADD COLUMN width integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='height') THEN
    ALTER TABLE course_post_media ADD COLUMN height integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='duration') THEN
    ALTER TABLE course_post_media ADD COLUMN duration integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='duration_seconds') THEN
    ALTER TABLE course_post_media ADD COLUMN duration_seconds integer;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='order_index') THEN
    ALTER TABLE course_post_media ADD COLUMN order_index integer DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='has_error') THEN
    ALTER TABLE course_post_media ADD COLUMN has_error boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='error_message') THEN
    ALTER TABLE course_post_media ADD COLUMN error_message text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='migration_error') THEN
    ALTER TABLE course_post_media ADD COLUMN migration_error text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='course_post_media' AND column_name='media_group_id') THEN
    ALTER TABLE course_post_media ADD COLUMN media_group_id text;
  END IF;
END $$;

-- student_pinned_posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_pinned_posts' AND column_name='user_id') THEN
    ALTER TABLE student_pinned_posts ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='student_pinned_posts' AND column_name='notes') THEN
    ALTER TABLE student_pinned_posts ADD COLUMN notes text;
  END IF;
END $$;

-- telegram_bots
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='channel_id') THEN
    ALTER TABLE telegram_bots ADD COLUMN channel_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='seller_id') THEN
    ALTER TABLE telegram_bots ADD COLUMN seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='course_id') THEN
    ALTER TABLE telegram_bots ADD COLUMN course_id uuid REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='bot_type') THEN
    ALTER TABLE telegram_bots ADD COLUMN bot_type text DEFAULT 'seller';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='webhook_secret') THEN
    ALTER TABLE telegram_bots ADD COLUMN webhook_secret text NOT NULL DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='webhook_url') THEN
    ALTER TABLE telegram_bots ADD COLUMN webhook_url text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='last_sync_at') THEN
    ALTER TABLE telegram_bots ADD COLUMN last_sync_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_bots' AND column_name='updated_at') THEN
    ALTER TABLE telegram_bots ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- telegram_main_bot
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_main_bot' AND column_name='webhook_secret') THEN
    ALTER TABLE telegram_main_bot ADD COLUMN webhook_secret text NOT NULL DEFAULT (gen_random_uuid())::text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_main_bot' AND column_name='webhook_url') THEN
    ALTER TABLE telegram_main_bot ADD COLUMN webhook_url text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_main_bot' AND column_name='last_sync_at') THEN
    ALTER TABLE telegram_main_bot ADD COLUMN last_sync_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_main_bot' AND column_name='updated_at') THEN
    ALTER TABLE telegram_main_bot ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- telegram_media_group_buffer: ensure file_id has a default
ALTER TABLE telegram_media_group_buffer ALTER COLUMN file_id SET DEFAULT '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_media_group_buffer' AND column_name='media_data') THEN
    ALTER TABLE telegram_media_group_buffer ADD COLUMN media_data jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_media_group_buffer' AND column_name='caption') THEN
    ALTER TABLE telegram_media_group_buffer ADD COLUMN caption text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_media_group_buffer' AND column_name='received_at') THEN
    ALTER TABLE telegram_media_group_buffer ADD COLUMN received_at timestamptz DEFAULT now();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_media_group_buffer' AND column_name='message_date') THEN
    ALTER TABLE telegram_media_group_buffer ADD COLUMN message_date timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_media_group_buffer' AND column_name='course_id') THEN
    ALTER TABLE telegram_media_group_buffer ADD COLUMN course_id uuid;
  END IF;
END $$;

-- telegram_import_sessions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_import_sessions' AND column_name='telegram_user_id') THEN
    ALTER TABLE telegram_import_sessions ADD COLUMN telegram_user_id bigint;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_import_sessions' AND column_name='platform_user_id') THEN
    ALTER TABLE telegram_import_sessions ADD COLUMN platform_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_import_sessions' AND column_name='message_count') THEN
    ALTER TABLE telegram_import_sessions ADD COLUMN message_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='telegram_import_sessions' AND column_name='is_active') THEN
    ALTER TABLE telegram_import_sessions ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- pending_enrollments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pending_enrollments' AND column_name='telegram_id') THEN
    ALTER TABLE pending_enrollments ADD COLUMN telegram_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pending_enrollments' AND column_name='telegram_username') THEN
    ALTER TABLE pending_enrollments ADD COLUMN telegram_username text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pending_enrollments' AND column_name='user_id_ref') THEN
    ALTER TABLE pending_enrollments ADD COLUMN user_id_ref text;
  END IF;
END $$;

-- media_access_tokens
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_access_tokens' AND column_name='course_id') THEN
    ALTER TABLE media_access_tokens ADD COLUMN course_id uuid REFERENCES courses(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_access_tokens' AND column_name='file_id') THEN
    ALTER TABLE media_access_tokens ADD COLUMN file_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_access_tokens' AND column_name='media_path') THEN
    ALTER TABLE media_access_tokens ADD COLUMN media_path text;
  END IF;
END $$;

-- featured_courses: ensure correct structure (standalone rows, not references)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='title') THEN
    ALTER TABLE featured_courses ADD COLUMN title text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='description') THEN
    ALTER TABLE featured_courses ADD COLUMN description text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='category') THEN
    ALTER TABLE featured_courses ADD COLUMN category text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='instructor') THEN
    ALTER TABLE featured_courses ADD COLUMN instructor text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='image_url') THEN
    ALTER TABLE featured_courses ADD COLUMN image_url text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='is_active') THEN
    ALTER TABLE featured_courses ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='featured_courses' AND column_name='updated_at') THEN
    ALTER TABLE featured_courses ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- ad_posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ad_posts' AND column_name='file_size') THEN
    ALTER TABLE ad_posts ADD COLUMN file_size bigint;
  END IF;
END $$;

-- ads_posts (backend route table)
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

-- ============================================================================
-- FIX CHECK CONSTRAINTS
-- ============================================================================

ALTER TABLE course_post_media DROP CONSTRAINT IF EXISTS course_post_media_media_type_check;
ALTER TABLE course_post_media ADD CONSTRAINT course_post_media_media_type_check
  CHECK (media_type = ANY (ARRAY['video'::text, 'image'::text, 'document'::text, 'photo'::text, 'audio'::text, 'animation'::text, 'voice'::text, 'media_group'::text]));

ALTER TABLE course_posts DROP CONSTRAINT IF EXISTS course_posts_media_type_check;
ALTER TABLE course_posts ADD CONSTRAINT course_posts_media_type_check
  CHECK (media_type = ANY (ARRAY['video'::text, 'image'::text, 'document'::text, 'text'::text, 'file'::text, 'photo'::text, 'audio'::text, 'animation'::text, 'media_group'::text, 'voice'::text]));

-- ============================================================================
-- UNIQUE CONSTRAINTS
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_media_group_buffer_unique
  ON telegram_media_group_buffer (media_group_id, telegram_message_id);

-- ============================================================================
-- MISSING INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_oauth_id ON users(oauth_id);
CREATE INDEX IF NOT EXISTS idx_users_oauth_provider ON users(oauth_provider);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_id_idx
  ON users (oauth_provider, oauth_id)
  WHERE oauth_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sellers_premium_active ON sellers(premium_active);
CREATE INDEX IF NOT EXISTS idx_courses_telegram_chat_id ON courses(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_granted_by ON course_enrollments(granted_by);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson_id ON lesson_progress(lesson_id);

CREATE INDEX IF NOT EXISTS idx_course_posts_published_at ON course_posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_posts_order_index ON course_posts(order_index);
CREATE INDEX IF NOT EXISTS idx_course_posts_has_error ON course_posts(has_error) WHERE has_error = true;
CREATE INDEX IF NOT EXISTS idx_course_posts_source_type ON course_posts(source_type);
CREATE INDEX IF NOT EXISTS idx_course_posts_is_pinned ON course_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_course_posts_media_group_id ON course_posts(media_group_id) WHERE media_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_post_media_order ON course_post_media(post_id, order_index);
CREATE INDEX IF NOT EXISTS idx_course_post_media_media_group_id ON course_post_media(media_group_id);

CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_post_id ON student_pinned_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_user_id ON student_pinned_posts(user_id);

CREATE INDEX IF NOT EXISTS idx_telegram_bots_seller_id ON telegram_bots(seller_id);
CREATE INDEX IF NOT EXISTS idx_telegram_media_group_buffer_received_at ON telegram_media_group_buffer(received_at);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_course_id ON telegram_messages(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_date ON telegram_messages(message_date DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_media_message_id ON telegram_media(message_id);

CREATE INDEX IF NOT EXISTS pkce_sessions_state_idx ON pkce_sessions(state);
CREATE INDEX IF NOT EXISTS pkce_sessions_expires_at_idx ON pkce_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_featured_courses_order ON featured_courses(order_index) WHERE is_active = true;

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
-- TRIGGERS (recreate safely)
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

-- ============================================================================
-- DISABLE RLS ON ALL TABLES
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

-- ============================================================================
-- SITE CONTACTS AND METRICS TABLES
-- ============================================================================

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

DROP TRIGGER IF EXISTS update_site_contacts_updated_at ON site_contacts;
CREATE TRIGGER update_site_contacts_updated_at
  BEFORE UPDATE ON site_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_site_metrics_updated_at ON site_metrics;
CREATE TRIGGER update_site_metrics_updated_at
  BEFORE UPDATE ON site_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO site_contacts (label, value, icon, url, order_index)
SELECT 'Email', 'info@keykurs.ru', 'Mail', 'mailto:info@keykurs.ru', 0
WHERE NOT EXISTS (SELECT 1 FROM site_contacts LIMIT 1);

INSERT INTO site_contacts (label, value, icon, url, order_index)
SELECT 'Telegram', '@keykurs', 'Send', 'https://t.me/keykurs', 1
WHERE NOT EXISTS (SELECT 1 FROM site_contacts WHERE order_index = 1);

INSERT INTO site_contacts (label, value, icon, url, order_index)
SELECT 'ВКонтакте', 'vk.com/keykurs', 'Globe', 'https://vk.com/keykurs', 2
WHERE NOT EXISTS (SELECT 1 FROM site_contacts WHERE order_index = 2);

INSERT INTO site_metrics (label, value, icon, order_index)
SELECT 'Курсов', '500+', 'BookOpen', 0
WHERE NOT EXISTS (SELECT 1 FROM site_metrics LIMIT 1);

INSERT INTO site_metrics (label, value, icon, order_index)
SELECT 'Студентов', '10 000+', 'Users', 1
WHERE NOT EXISTS (SELECT 1 FROM site_metrics WHERE order_index = 1);

INSERT INTO site_metrics (label, value, icon, order_index)
SELECT 'Преподавателей', '150+', 'Award', 2
WHERE NOT EXISTS (SELECT 1 FROM site_metrics WHERE order_index = 2);

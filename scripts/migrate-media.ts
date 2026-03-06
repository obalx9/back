#!/usr/bin/env tsx

/**
 * Media Migration Script
 *
 * Migrates legacy media files from Telegram (telegram_file_id) to Timeweb S3 (s3_url)
 *
 * Coverage:
 * 1. course_post_media.telegram_file_id → s3_url
 * 2. course_post_media.telegram_thumbnail_file_id → thumbnail_s3_url
 * 3. course_posts.telegram_file_id → media_url (for single media posts)
 * 4. course_posts.telegram_thumbnail_file_id → thumbnail_url
 *
 * Usage:
 *   npm run migrate-media
 *   # or with options:
 *   tsx scripts/migrate-media.ts --dry-run
 *   tsx scripts/migrate-media.ts --batch-size 50
 *   tsx scripts/migrate-media.ts --skip-errors
 */

import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { query } from '../src/utils/db';
import { uploadToS3, generateS3Key } from '../src/services/s3Service';
import { logger } from '../src/utils/logger';

interface CoursePostMediaRecord {
  id: string;
  post_id: string;
  media_type: string;
  telegram_file_id: string | null;
  telegram_thumbnail_file_id: string | null;
  s3_url: string | null;
  thumbnail_s3_url: string | null;
  file_name: string | null;
  course_id: string;
}

interface CoursePostRecord {
  id: string;
  course_id: string;
  media_type: string | null;
  telegram_file_id: string | null;
  telegram_thumbnail_file_id: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
}

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_ERRORS = process.argv.includes('--skip-errors');
const BATCH_SIZE = parseInt(
  process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '10'
);

async function getBotTokenForCourse(courseId: string): Promise<string | null> {
  const result = await query<{ bot_token: string }>(
    `SELECT tb.bot_token
     FROM telegram_bots tb
     JOIN courses c ON c.seller_id = tb.seller_id
     WHERE c.id = $1
     LIMIT 1`,
    [courseId]
  );

  return result.rows[0]?.bot_token || null;
}

async function downloadTelegramFile(
  botToken: string,
  fileId: string
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  logger.info('Downloading from Telegram', { fileId: fileId.substring(0, 20) + '...' });

  const fileInfoResponse = await axios.get(
    `https://api.telegram.org/bot${botToken}/getFile`,
    { params: { file_id: fileId }, timeout: 10000 }
  );

  if (!fileInfoResponse.data.ok) {
    throw new Error(`Telegram API error: ${fileInfoResponse.data.description}`);
  }

  const fileInfo = fileInfoResponse.data.result;
  const filePath = fileInfo.file_path;
  const fileName = filePath.split('/').pop() || 'file';

  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const fileResponse = await axios.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  return {
    buffer: Buffer.from(fileResponse.data),
    contentType: fileResponse.headers['content-type'] || 'application/octet-stream',
    fileName,
  };
}

async function migrateCoursePostMedia() {
  logger.info('=== Migrating course_post_media table ===');

  const records = await query<CoursePostMediaRecord>(
    `SELECT
       cpm.id,
       cpm.post_id,
       cpm.media_type,
       cpm.telegram_file_id,
       cpm.telegram_thumbnail_file_id,
       cpm.s3_url,
       cpm.thumbnail_s3_url,
       cpm.file_name,
       cp.course_id
     FROM course_post_media cpm
     JOIN course_posts cp ON cp.id = cpm.post_id
     WHERE (cpm.telegram_file_id IS NOT NULL AND cpm.s3_url IS NULL)
        OR (cpm.telegram_thumbnail_file_id IS NOT NULL AND cpm.thumbnail_s3_url IS NULL)
     ORDER BY cpm.created_at DESC`
  );

  logger.info(`Found ${records.rows.length} course_post_media records to migrate`);

  const recordsByCourse = new Map<string, CoursePostMediaRecord[]>();
  for (const record of records.rows) {
    if (!recordsByCourse.has(record.course_id)) {
      recordsByCourse.set(record.course_id, []);
    }
    recordsByCourse.get(record.course_id)!.push(record);
  }

  let successCount = 0;
  let errorCount = 0;

  for (const [courseId, courseRecords] of recordsByCourse) {
    logger.info(`Processing course ${courseId} (${courseRecords.length} records)`);

    const botToken = await getBotTokenForCourse(courseId);
    if (!botToken) {
      logger.warn(`No bot token found for course ${courseId}, skipping`);
      errorCount += courseRecords.length;
      continue;
    }

    for (const record of courseRecords) {
      try {
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Migrate main file
        if (record.telegram_file_id && !record.s3_url) {
          if (DRY_RUN) {
            logger.info('[DRY RUN] Would migrate main file', {
              id: record.id,
              fileId: record.telegram_file_id.substring(0, 20) + '...',
            });
          } else {
            const { buffer, contentType, fileName } = await downloadTelegramFile(
              botToken,
              record.telegram_file_id
            );

            const s3Key = generateS3Key(
              courseId,
              record.file_name || fileName,
              record.media_type
            );

            const s3Url = await uploadToS3(s3Key, buffer, contentType);

            updates.push(`s3_url = $${paramIndex++}`);
            values.push(s3Url);
            updates.push(`telegram_file_id = NULL`);

            logger.info('Migrated main file', {
              id: record.id,
              s3Url,
              size: buffer.length,
            });
          }
        }

        // Migrate thumbnail
        if (record.telegram_thumbnail_file_id && !record.thumbnail_s3_url) {
          if (DRY_RUN) {
            logger.info('[DRY RUN] Would migrate thumbnail', {
              id: record.id,
              fileId: record.telegram_thumbnail_file_id.substring(0, 20) + '...',
            });
          } else {
            const { buffer, contentType, fileName } = await downloadTelegramFile(
              botToken,
              record.telegram_thumbnail_file_id
            );

            const s3Key = generateS3Key(
              courseId,
              `thumb_${record.file_name || fileName}`,
              'photo'
            );

            const thumbnailS3Url = await uploadToS3(s3Key, buffer, contentType);

            updates.push(`thumbnail_s3_url = $${paramIndex++}`);
            values.push(thumbnailS3Url);
            updates.push(`telegram_thumbnail_file_id = NULL`);

            logger.info('Migrated thumbnail', {
              id: record.id,
              thumbnailS3Url,
              size: buffer.length,
            });
          }
        }

        if (updates.length > 0 && !DRY_RUN) {
          values.push(record.id);
          await query(
            `UPDATE course_post_media SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        }

        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        logger.error('Failed to migrate course_post_media record', {
          id: record.id,
          error: error?.message,
        });
        errorCount++;

        if (!SKIP_ERRORS) {
          throw error;
        }
      }
    }
  }

  logger.info('course_post_media migration completed', {
    success: successCount,
    errors: errorCount,
  });

  return { successCount, errorCount };
}

async function migrateCoursePosts() {
  logger.info('=== Migrating course_posts table ===');

  const records = await query<CoursePostRecord>(
    `SELECT
       id,
       course_id,
       media_type,
       telegram_file_id,
       telegram_thumbnail_file_id,
       media_url,
       thumbnail_url
     FROM course_posts
     WHERE (telegram_file_id IS NOT NULL AND media_url IS NULL)
        OR (telegram_thumbnail_file_id IS NOT NULL AND thumbnail_url IS NULL)
     ORDER BY created_at DESC`
  );

  logger.info(`Found ${records.rows.length} course_posts records to migrate`);

  const recordsByCourse = new Map<string, CoursePostRecord[]>();
  for (const record of records.rows) {
    if (!recordsByCourse.has(record.course_id)) {
      recordsByCourse.set(record.course_id, []);
    }
    recordsByCourse.get(record.course_id)!.push(record);
  }

  let successCount = 0;
  let errorCount = 0;

  for (const [courseId, courseRecords] of recordsByCourse) {
    logger.info(`Processing course ${courseId} (${courseRecords.length} posts)`);

    const botToken = await getBotTokenForCourse(courseId);
    if (!botToken) {
      logger.warn(`No bot token found for course ${courseId}, skipping`);
      errorCount += courseRecords.length;
      continue;
    }

    for (const record of courseRecords) {
      try {
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Migrate main media file
        if (record.telegram_file_id && !record.media_url) {
          if (DRY_RUN) {
            logger.info('[DRY RUN] Would migrate post media', {
              id: record.id,
              fileId: record.telegram_file_id.substring(0, 20) + '...',
            });
          } else {
            const { buffer, contentType, fileName } = await downloadTelegramFile(
              botToken,
              record.telegram_file_id
            );

            const s3Key = generateS3Key(
              courseId,
              fileName,
              record.media_type || 'photo'
            );

            const mediaUrl = await uploadToS3(s3Key, buffer, contentType);

            updates.push(`media_url = $${paramIndex++}`);
            values.push(mediaUrl);
            updates.push(`telegram_file_id = NULL`);

            logger.info('Migrated post media', {
              id: record.id,
              mediaUrl,
              size: buffer.length,
            });
          }
        }

        // Migrate thumbnail
        if (record.telegram_thumbnail_file_id && !record.thumbnail_url) {
          if (DRY_RUN) {
            logger.info('[DRY RUN] Would migrate post thumbnail', {
              id: record.id,
              fileId: record.telegram_thumbnail_file_id.substring(0, 20) + '...',
            });
          } else {
            const { buffer, contentType, fileName } = await downloadTelegramFile(
              botToken,
              record.telegram_thumbnail_file_id
            );

            const s3Key = generateS3Key(
              courseId,
              `thumb_${fileName}`,
              'photo'
            );

            const thumbnailUrl = await uploadToS3(s3Key, buffer, contentType);

            updates.push(`thumbnail_url = $${paramIndex++}`);
            values.push(thumbnailUrl);
            updates.push(`telegram_thumbnail_file_id = NULL`);

            logger.info('Migrated post thumbnail', {
              id: record.id,
              thumbnailUrl,
              size: buffer.length,
            });
          }
        }

        if (updates.length > 0 && !DRY_RUN) {
          values.push(record.id);
          await query(
            `UPDATE course_posts SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
          );
        }

        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        logger.error('Failed to migrate course_posts record', {
          id: record.id,
          error: error?.message,
        });
        errorCount++;

        if (!SKIP_ERRORS) {
          throw error;
        }
      }
    }
  }

  logger.info('course_posts migration completed', {
    success: successCount,
    errors: errorCount,
  });

  return { successCount, errorCount };
}

async function main() {
  logger.info('Starting comprehensive media migration', {
    dryRun: DRY_RUN,
    skipErrors: SKIP_ERRORS,
    batchSize: BATCH_SIZE,
  });

  const results = {
    coursePostMedia: { successCount: 0, errorCount: 0 },
    coursePosts: { successCount: 0, errorCount: 0 },
  };

  // Migrate course_post_media (albums and media groups)
  results.coursePostMedia = await migrateCoursePostMedia();

  // Migrate course_posts (single media posts)
  results.coursePosts = await migrateCoursePosts();

  const totalSuccess = results.coursePostMedia.successCount + results.coursePosts.successCount;
  const totalErrors = results.coursePostMedia.errorCount + results.coursePosts.errorCount;

  logger.info('=== MIGRATION COMPLETE ===', {
    coursePostMedia: results.coursePostMedia,
    coursePosts: results.coursePosts,
    total: {
      success: totalSuccess,
      errors: totalErrors,
    },
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) {
    logger.info('[DRY RUN] No changes were made to the database');
  }

  process.exit(totalErrors > 0 && !SKIP_ERRORS ? 1 : 0);
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', error);
  process.exit(1);
});

main().catch((error) => {
  logger.error('Migration failed', error);
  process.exit(1);
});

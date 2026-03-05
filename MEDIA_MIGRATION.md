# Media Migration Guide

## Overview

This guide explains the migration from Telegram-proxied media to S3-stored media.

## Architecture Change

### Before (Supabase + Telegram Proxy)
```
Telegram Message → Webhook saves telegram_file_id → Database
→ Client requests media → Edge Function → Proxies from Telegram API in real-time
```

**Issues**:
- Real-time proxying from Telegram API (slow)
- Telegram file_id expires after some time
- 20MB file size limit via getFile
- Depends on Telegram API availability

### After (Timeweb S3)
```
Telegram Message → Webhook downloads file → Uploads to S3 → Saves s3_url → Database
→ Client requests media → Direct S3 URL (fast)
```

**Benefits**:
- Files stored permanently in S3
- No size limits (except S3 bucket)
- Fast CDN delivery
- Independent from Telegram API
- No real-time proxying needed

## Database Schema Changes

### Old Schema
```sql
course_post_media (
  id uuid,
  post_id uuid,
  media_type text,
  telegram_file_id text,  -- Used for Telegram proxy
  file_name text,
  ...
)
```

### New Schema
```sql
course_post_media (
  id uuid,
  post_id uuid,
  media_type text,
  s3_url text,            -- Direct S3 URL
  telegram_file_id text,  -- NULL after migration
  file_name text,
  ...
)
```

## Migration Process

### 1. New Media (Automatic)

All new media uploaded via Telegram webhook automatically:
1. Downloads file from Telegram API
2. Uploads to Timeweb S3
3. Stores `s3_url` in database
4. Sets `telegram_file_id` to NULL

No action required - this is handled by `src/services/telegramService.ts`

### 2. Existing Media (Manual Migration Required)

For existing records with `telegram_file_id` but no `s3_url`, run the migration script.

#### Prerequisites

1. **Timeweb S3 Configured**
   ```bash
   # In .env
   S3_ENDPOINT=https://s3.timeweb.cloud
   S3_ACCESS_KEY_ID=your_key
   S3_SECRET_ACCESS_KEY=your_secret
   S3_BUCKET=keykurs-media
   S3_PUBLIC_URL=https://your-bucket.s3.timeweb.cloud
   ```

2. **Database Access**
   ```bash
   DATABASE_URL=postgresql://user:pass@host:5432/keykurs
   ```

3. **Bot Tokens Available**
   - Migration script looks up bot tokens from `telegram_bots` table
   - Ensure all courses have associated bots

#### Running Migration

**Dry Run (Recommended First)**
```bash
npm run migrate-media:dry-run
```

This shows what would be migrated without making changes.

**Full Migration**
```bash
npm run migrate-media
```

**With Options**
```bash
# Skip records that fail
npm run migrate-media -- --skip-errors

# Custom batch size (default: 10)
npm run migrate-media -- --batch-size=50

# Combine options
npm run migrate-media -- --batch-size=20 --skip-errors
```

#### Migration Script Behavior

The script (`scripts/migrate-media.ts`):

1. **Finds all records** with `telegram_file_id` but no `s3_url`
2. **Groups by course** to minimize bot token lookups
3. **For each record**:
   - Gets bot token for the course
   - Downloads file from Telegram API
   - Uploads to S3
   - Updates database: sets `s3_url`, clears `telegram_file_id`
4. **Rate limiting**: 100ms between files, 1s between batches
5. **Error handling**:
   - Logs all errors
   - Optionally skips failed records with `--skip-errors`
   - Marks failed records in database

#### Monitoring Progress

The script logs:
```
INFO: Starting media migration
INFO: Found 1523 records to migrate
INFO: Records grouped into 45 courses
INFO: Processing course abc-123 (67 records)
INFO: Processing batch 1/7
INFO: Downloading from Telegram fileId=AgACAgIA...
INFO: Successfully migrated id=xyz-789, s3Url=https://..., size=1048576
...
INFO: Migration completed
  total: 1523
  success: 1498
  errors: 15
  skipped: 10
```

#### Troubleshooting

**Bot token not found**
```
WARN: No bot token found for course abc-123, skipping
```

Solution: Ensure course has associated bot in `telegram_bots` table

**Telegram API errors**
```
ERROR: Telegram API error: file is too big
```

Solution: Files > 20MB cannot be downloaded via Telegram API. Mark as error and handle manually.

**S3 upload errors**
```
ERROR: S3 upload failed: AccessDenied
```

Solution: Check S3 credentials and bucket permissions

**Network timeouts**
```
ERROR: timeout of 60000ms exceeded
```

Solution: Large files may timeout. Increase timeout in script or run with `--skip-errors`

#### Post-Migration Verification

```sql
-- Check migration status
SELECT
  COUNT(*) FILTER (WHERE s3_url IS NOT NULL) as migrated,
  COUNT(*) FILTER (WHERE s3_url IS NULL AND telegram_file_id IS NOT NULL) as pending,
  COUNT(*) FILTER (WHERE s3_url IS NULL AND telegram_file_id IS NULL) as no_media
FROM course_post_media;

-- Find failed migrations
SELECT id, telegram_file_id, migration_error
FROM course_post_media
WHERE s3_url IS NULL AND telegram_file_id IS NOT NULL;
```

## Frontend Changes

### Old Code (Supabase)
```typescript
function getMediaUrl(media: Media): string {
  if (media.telegram_file_id) {
    return getTelegramMediaUrl(media.telegram_file_id, botToken);
  }
  return getSupabaseMediaUrl(media.storage_path);
}
```

### New Code (S3 Only)
```typescript
function getMediaUrl(media: Media): string {
  if (!media.s3_url) return '';
  if (media.s3_url.startsWith('http')) return media.s3_url;
  return api.getMediaUrl(media.s3_url);
}
```

The frontend is already updated in `deploy/frontend/src/lib/apiHelpers.ts`:
- `getMediaUrl()` - Returns S3 URL directly
- `getTelegramMediaUrl()` - Deprecated, logs warning

## Database Migration (Optional)

If you want to remove the `telegram_file_id` column entirely after migration:

```sql
-- WARNING: Only run after successful migration and verification

-- 1. Backup the table first
CREATE TABLE course_post_media_backup AS
SELECT * FROM course_post_media;

-- 2. Drop the column
ALTER TABLE course_post_media
DROP COLUMN telegram_file_id;

-- 3. Verify
SELECT * FROM course_post_media LIMIT 10;
```

## Performance Considerations

### Migration Speed
- **10 records/batch**: ~1-2 minutes per 100 records
- **50 records/batch**: ~30 seconds per 100 records (may hit rate limits)
- For 1000+ records, expect 15-30 minutes total

### S3 Storage
- Estimate storage: `SELECT SUM(file_size) FROM course_post_media;`
- Set up S3 lifecycle policies for cost optimization
- Enable CDN for faster global delivery

### Costs
- **Timeweb S3**: ~2₽/GB/month
- **Transfer**: Usually free for first TB
- **Requests**: Minimal cost for GET requests

## Rollback Plan

If you need to rollback:

1. **Restore Database**
   ```sql
   -- Restore from backup
   INSERT INTO course_post_media
   SELECT * FROM course_post_media_backup
   ON CONFLICT (id) DO UPDATE SET
     telegram_file_id = EXCLUDED.telegram_file_id;
   ```

2. **Keep S3 Files**
   - Don't delete S3 files (they're backups)
   - Can always re-migrate later

3. **Switch Backend**
   - Revert webhook to old behavior
   - Redeploy Edge Functions if needed

## Best Practices

1. **Always run dry-run first**
2. **Backup database before migration**
3. **Monitor logs during migration**
4. **Verify sample records after migration**
5. **Keep S3 and database in sync**
6. **Document any manual fixes**
7. **Plan for >20MB files separately**

## FAQ

**Q: What happens to files >20MB?**
A: Telegram API getFile has 20MB limit. These files cannot be migrated automatically and should be re-uploaded from source.

**Q: Can I run migration multiple times?**
A: Yes, it's idempotent. Records with `s3_url` are skipped.

**Q: What if a file was deleted from Telegram?**
A: Migration will fail for that record. Use `--skip-errors` to continue.

**Q: How long do I keep telegram_file_id?**
A: Until all records are migrated and verified. Then you can drop the column.

**Q: Can I migrate specific courses only?**
A: Yes, modify the script's WHERE clause to filter by course_id.

**Q: What about video thumbnails?**
A: Thumbnails are migrated separately. Check `thumbnail_s3_url` field.

## Support

For issues:
1. Check logs in console output
2. Query database for failed records
3. Review Telegram API documentation
4. Check S3 bucket permissions and CORS
5. Verify bot tokens are valid

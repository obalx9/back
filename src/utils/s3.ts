import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger.js';
import crypto from 'crypto';
import path from 'path';

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru';
const S3_REGION = process.env.S3_REGION || 'ru-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'keykurs-media';
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || `https://${S3_BUCKET}.s3.twcstorage.ru`;

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

export function generateS3Key(prefix: string, originalName?: string): string {
  const ext = originalName ? path.extname(originalName) : '';
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  return `${prefix}/${uniqueName}`;
}

export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType?: string
): Promise<{ success: boolean; key?: string; url?: string; error?: string }> {
  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    });

    await s3Client.send(command);

    logger.info(`Uploaded to S3: ${key}`);

    return {
      success: true,
      key,
      url: `${S3_PUBLIC_URL}/${key}`,
    };
  } catch (error) {
    logger.error('S3 upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown S3 upload error',
    };
  }
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFromS3(key: string): Promise<boolean> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`Deleted from S3: ${key}`);
    return true;
  } catch (error) {
    logger.error('S3 delete error:', error);
    return false;
  }
}

export async function getS3Object(key: string): Promise<Buffer | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const response = await s3Client.send(command);
    if (!response.Body) return null;

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    logger.error('S3 get error:', error);
    return null;
  }
}

export function getMediaPublicUrl(key: string): string {
  return `${S3_PUBLIC_URL}/${key}`;
}

export { s3Client, S3_BUCKET, S3_PUBLIC_URL };

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './logger.js';

const MEDIA_DIR = process.env.MEDIA_STORAGE_PATH || '/tmp/media';

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  thumbnail?: TelegramPhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
  thumbnail?: TelegramPhotoSize;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
    title?: string;
  };
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
}

export interface MediaData {
  media_type: 'photo' | 'video' | 'document' | 'voice' | 'audio' | 'text' | null;
  file_id: string | null;
  thumbnail_file_id: string | null;
  file_size: number | null;
  file_name: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  has_error: boolean;
  error_message: string | null;
}

/**
 * Downloads a file from Telegram and saves it to local storage
 */
export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  fileName?: string
): Promise<{ success: boolean; localPath?: string; url?: string; error?: string }> {
  try {
    // Get file path from Telegram
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );

    if (!fileInfoResponse.ok) {
      throw new Error(`Telegram API error: ${fileInfoResponse.status}`);
    }

    const fileInfo: any = await fileInfoResponse.json();

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      throw new Error('Failed to get file path from Telegram');
    }

    const filePath = fileInfo.result.file_path;
    const fileSize = fileInfo.result.file_size || 0;

    // Check file size limit (20MB for Telegram API)
    if (fileSize > 20 * 1024 * 1024) {
      return {
        success: false,
        error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB). Telegram API limit is 20MB.`
      };
    }

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    // Generate unique filename
    const ext = path.extname(fileName || filePath);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const uploadPath = path.join(MEDIA_DIR, 'telegram-media');

    await fs.mkdir(uploadPath, { recursive: true });

    const localPath = path.join(uploadPath, uniqueName);

    // Save file
    await fs.writeFile(localPath, buffer);

    // Return relative path from MEDIA_DIR
    const relativePath = path.relative(MEDIA_DIR, localPath);
    const publicUrl = `/api/media/public/${relativePath}`;

    logger.info(`Downloaded Telegram file: ${fileId} -> ${relativePath}`);

    return {
      success: true,
      localPath: relativePath,
      url: publicUrl
    };
  } catch (error) {
    logger.error('Error downloading Telegram file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Extracts media data from a Telegram message
 */
export function extractMediaData(message: TelegramMessage): MediaData {
  const result: MediaData = {
    media_type: null,
    file_id: null,
    thumbnail_file_id: null,
    file_size: null,
    file_name: null,
    mime_type: null,
    width: null,
    height: null,
    duration: null,
    has_error: false,
    error_message: null,
  };

  try {
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo.reduce((prev, current) =>
        (current.file_size || 0) > (prev.file_size || 0) ? current : prev
      );
      result.media_type = 'photo';
      result.file_id = largestPhoto.file_id;
      result.file_size = largestPhoto.file_size || null;
      result.width = largestPhoto.width;
      result.height = largestPhoto.height;
      result.mime_type = 'image/jpeg';
    } else if (message.video) {
      result.media_type = 'video';
      result.file_id = message.video.file_id;
      result.file_size = message.video.file_size || null;
      result.file_name = message.video.file_name || null;
      result.mime_type = message.video.mime_type || 'video/mp4';
      result.width = message.video.width;
      result.height = message.video.height;
      result.duration = message.video.duration;
      result.thumbnail_file_id = message.video.thumbnail?.file_id || null;
    } else if (message.document) {
      result.media_type = 'document';
      result.file_id = message.document.file_id;
      result.file_size = message.document.file_size || null;
      result.file_name = message.document.file_name || null;
      result.mime_type = message.document.mime_type || 'application/octet-stream';
      result.thumbnail_file_id = message.document.thumbnail?.file_id || null;
    } else if (message.voice) {
      result.media_type = 'voice';
      result.file_id = message.voice.file_id;
      result.file_size = message.voice.file_size || null;
      result.mime_type = message.voice.mime_type || 'audio/ogg';
      result.duration = message.voice.duration;
    } else if (message.audio) {
      result.media_type = 'audio';
      result.file_id = message.audio.file_id;
      result.file_size = message.audio.file_size || null;
      result.mime_type = message.audio.mime_type || 'audio/mpeg';
      result.duration = message.audio.duration;
      result.file_name = message.audio.title || message.audio.performer || null;
      result.thumbnail_file_id = message.audio.thumbnail?.file_id || null;
    } else if (message.text) {
      result.media_type = 'text';
    }
  } catch (error) {
    result.has_error = true;
    result.error_message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error extracting media data:', error);
  }

  return result;
}

/**
 * Downloads Telegram file and returns local storage info
 */
export async function processAndDownloadMedia(
  botToken: string,
  message: TelegramMessage
): Promise<{
  mediaData: MediaData;
  localPath?: string;
  thumbnailPath?: string;
}> {
  const mediaData = extractMediaData(message);

  if (!mediaData.file_id || mediaData.media_type === 'text') {
    return { mediaData };
  }

  // Download main file
  const downloadResult = await downloadTelegramFile(
    botToken,
    mediaData.file_id,
    mediaData.file_name || undefined
  );

  let localPath: string | undefined;
  let thumbnailPath: string | undefined;

  if (downloadResult.success) {
    localPath = downloadResult.localPath;
  } else {
    // If download failed, store error but keep telegram_file_id for fallback
    mediaData.has_error = true;
    mediaData.error_message = downloadResult.error || 'Failed to download file';
    logger.warn(`Failed to download file ${mediaData.file_id}: ${downloadResult.error}`);
  }

  // Download thumbnail if exists
  if (mediaData.thumbnail_file_id) {
    const thumbResult = await downloadTelegramFile(botToken, mediaData.thumbnail_file_id);
    if (thumbResult.success) {
      thumbnailPath = thumbResult.localPath;
    }
  }

  return {
    mediaData,
    localPath,
    thumbnailPath
  };
}

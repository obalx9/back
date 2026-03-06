import * as path from 'path';
import { logger } from './logger.js';
import { uploadToS3, generateS3Key } from './s3.js';

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

interface TelegramAnimation {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
    title?: string;
  };
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  text?: string;
  caption?: string;
  media_group_id?: string;
  forward_from?: any;
  forward_from_chat?: any;
  forward_date?: number;
  forward_sender_name?: string;
  forward_origin?: {
    type: string;
    date: number;
    chat?: { id: number; type: string };
    message_id?: number;
    sender_user?: { id: number };
  };
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  animation?: TelegramAnimation;
}

export interface MediaData {
  media_type: string | null;
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

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  fileName?: string,
  mimeType?: string
): Promise<{ success: boolean; s3Key?: string; error?: string }> {
  try {
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

    if (fileSize > 20 * 1024 * 1024) {
      return {
        success: false,
        error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB). Telegram API limit is 20MB.`
      };
    }

    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status}`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    const actualFileName = fileName || path.basename(filePath);
    const s3Key = generateS3Key('telegram-media', actualFileName);
    const contentType = mimeType || guessMimeType(filePath);

    const uploadResult = await uploadToS3(buffer, s3Key, contentType);

    if (!uploadResult.success) {
      throw new Error(uploadResult.error || 'S3 upload failed');
    }

    logger.info(`Downloaded Telegram file to S3: ${fileId} -> ${s3Key}`);

    return {
      success: true,
      s3Key,
    };
  } catch (error) {
    logger.error('Error downloading Telegram file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
    '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Extracts media data from a Telegram message
 */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function extractMediaData(message: TelegramMessage): MediaData {
  let mediaType: string | null = null;
  let fileId: string | null = null;
  let fileSize: number | null = null;
  let fileName: string | null = null;
  let mimeType: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;
  let thumbnailFileId: string | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  if (message.photo && message.photo.length > 0) {
    mediaType = 'image';
    const largestPhoto = message.photo.reduce((prev, current) =>
      (current.file_size || 0) > (prev.file_size || 0) ? current : prev
    );
    fileId = largestPhoto.file_id;
    fileSize = largestPhoto.file_size || null;
    width = largestPhoto.width;
    height = largestPhoto.height;
  } else if (message.video) {
    mediaType = 'video';
    fileSize = message.video.file_size || null;
    fileName = 'video';
    mimeType = message.video.mime_type || null;
    width = message.video.width;
    height = message.video.height;
    duration = message.video.duration;

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      hasError = true;
      errorMessage = `Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(2)} MB). Telegram не позволяет загружать файлы больше 20 MB. Пожалуйста, загрузите видео вручную через сайт.`;
      fileId = null;
      thumbnailFileId = null;
    } else {
      fileId = message.video.file_id;
      thumbnailFileId = message.video.thumbnail?.file_id || null;
    }
  } else if (message.document) {
    mediaType = 'document';
    fileSize = message.document.file_size || null;
    fileName = message.document.file_name || null;
    mimeType = message.document.mime_type || null;

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      hasError = true;
      errorMessage = `Файл слишком большой (${(fileSize / 1024 / 1024).toFixed(2)} MB). Telegram не позволяет загружать файлы больше 20 MB. Пожалуйста, загрузите файл вручную через сайт.`;
      fileId = null;
    } else {
      fileId = message.document.file_id;
    }
  } else if (message.audio) {
    mediaType = 'audio';
    fileId = message.audio.file_id;
    fileSize = message.audio.file_size || null;
    fileName = message.audio.file_id || null;
    mimeType = message.audio.mime_type || null;
    duration = message.audio.duration;
  } else if (message.animation) {
    mediaType = 'animation';
    fileId = message.animation.file_id;
    fileSize = message.animation.file_size || null;
    mimeType = message.animation.mime_type || null;
    width = message.animation.width;
    height = message.animation.height;
    duration = message.animation.duration;
    thumbnailFileId = message.animation.thumbnail?.file_id || null;
  } else if (message.voice) {
    mediaType = 'voice';
    fileId = message.voice.file_id;
    fileSize = message.voice.file_size || null;
    mimeType = message.voice.mime_type || null;
    duration = message.voice.duration;
    fileName = 'voice_message';
  }

  return {
    media_type: mediaType,
    file_id: fileId,
    file_size: fileSize,
    file_name: fileName,
    mime_type: mimeType,
    width,
    height,
    duration,
    thumbnail_file_id: thumbnailFileId,
    has_error: hasError,
    error_message: errorMessage,
  };
}

export async function checkFileAccessible(botToken: string, fileId: string): Promise<{ accessible: boolean; fileSize?: number }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const data: any = await resp.json();
    if (data.ok && data.result?.file_path) {
      return { accessible: true, fileSize: data.result.file_size };
    }
    return { accessible: false };
  } catch {
    return { accessible: false };
  }
}

export async function processAndDownloadMedia(
  botToken: string,
  message: TelegramMessage
): Promise<{
  mediaData: MediaData;
  localPath?: string;
  thumbnailPath?: string;
}> {
  const mediaData = extractMediaData(message);

  if (!mediaData.file_id || mediaData.has_error) {
    return { mediaData };
  }

  const downloadResult = await downloadTelegramFile(
    botToken,
    mediaData.file_id,
    mediaData.file_name || undefined,
    mediaData.mime_type || undefined
  );

  let localPath: string | undefined;
  let thumbnailPath: string | undefined;

  if (downloadResult.success) {
    localPath = downloadResult.s3Key;
  } else {
    mediaData.has_error = true;
    mediaData.error_message = downloadResult.error || 'Failed to download file';
    logger.warn(`Failed to download file ${mediaData.file_id}: ${downloadResult.error}`);
  }

  if (mediaData.thumbnail_file_id) {
    const thumbResult = await downloadTelegramFile(
      botToken,
      mediaData.thumbnail_file_id,
      undefined,
      'image/jpeg'
    );
    if (thumbResult.success) {
      thumbnailPath = thumbResult.s3Key;
    }
  }

  return {
    mediaData,
    localPath,
    thumbnailPath
  };
}

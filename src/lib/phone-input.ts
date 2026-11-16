import { callable } from '@decky/api';

export interface UrlInputSession {
  session_id: string;
  url: string;
  expires_in: number;
  upload_directory?: string;
  upload_picker_directory?: string;
}

export type UrlInputStatus =
  | { status: 'waiting' | 'uploading' | 'expired' }
  | { status: 'received'; url: string };

export const UPLOAD_DIRECTORY_KEY = 'portal.uploadDirectory';
export const getUploadDirectory = callable<[directory: string], { directory: string }>(
  'get_upload_directory',
);
export const startUrlInput = callable<[directory: string], UrlInputSession>('start_url_input');
export const getUrlInputStatus = callable<[sessionId: string], UrlInputStatus>(
  'get_url_input_status',
);
export const cancelUrlInput = callable<[sessionId: string], void>('cancel_url_input');

import { callable } from '@decky/api';

export interface UrlInputSession {
  session_id: string;
  url: string;
  expires_in: number;
}

export type UrlInputStatus =
  | { status: 'waiting' | 'expired' }
  | { status: 'received'; url: string };

export const startUrlInput = callable<[], UrlInputSession>('start_url_input');
export const getUrlInputStatus = callable<[sessionId: string], UrlInputStatus>(
  'get_url_input_status',
);
export const cancelUrlInput = callable<[sessionId: string], void>('cancel_url_input');

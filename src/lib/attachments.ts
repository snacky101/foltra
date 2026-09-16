import { call } from './api';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export interface Attachment {
  path: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  data?: string;
}

export function attachmentPath(source: string): string | null {
  const path = source.replace(/^\.\.\//, '');
  return /^attachments\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(path) ? path : null;
}

export async function importClipboardImage(vault: string, file: File): Promise<Attachment> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 10 MiB 이하로 붙여넣어 주세요.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('클립보드 이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
  return call<Attachment>(vault, 'attachment.import', { data });
}

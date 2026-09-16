import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { attachmentPath, type Attachment } from '../lib/attachments';

export function AttachmentImage({
  vault,
  source,
  alt = '',
}: {
  vault: string;
  source: string;
  alt?: string;
}) {
  const path = attachmentPath(source);
  const key = `${vault}\n${path}`;
  const [loaded, setLoaded] = useState<{ key: string; image?: Attachment; error?: string }>();
  useEffect(() => {
    if (!path) return;
    let active = true;
    void call<Attachment>(vault, 'attachment.read', { path })
      .then((image) => {
        if (active) setLoaded({ key, image });
      })
      .catch(() => {
        if (active) setLoaded({ key, error: '첨부 이미지를 찾거나 읽을 수 없습니다.' });
      });
    return () => {
      active = false;
    };
  }, [vault, path, key]);
  if (!path)
    return <span className="blocked-image">이미지: {alt || '외부 이미지'} (자동 로드하지 않음)</span>;
  const current = loaded?.key === key ? loaded : undefined;
  if (!current?.image)
    return (
      <span className="attachment-placeholder" role={current?.error ? 'status' : undefined}>
        {current?.error ?? '이미지 불러오는 중…'}
      </span>
    );
  return (
    <img
      className="attachment-image"
      src={`data:${current.image.mimeType};base64,${current.image.data}`}
      alt={alt}
      width={current.image.width}
      height={current.image.height}
      onError={() => setLoaded({ key, error: '첨부 이미지를 표시할 수 없습니다.' })}
    />
  );
}

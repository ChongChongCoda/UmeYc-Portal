import { useState } from 'react';
import { toaster, callable } from '@decky/api';
import icons from '../../assets/zoom-icons.json';

export const WEB_HEADER_HEIGHT = 34;
export type ZoomAction = 'smaller' | 'default' | 'larger';
const zoomWebPage = callable<[url: string, action: ZoomAction], { factor: number }>(
  'zoom_web_page',
);

export const WebHeader = ({
  title,
  getUrl,
  x,
  y,
  width,
}: {
  title: string;
  getUrl: () => string;
  x: number;
  y: number;
  width: number;
}) => {
  const [pending, setPending] = useState(false);
  const zoom = async (action: ZoomAction) => {
    if (pending) return;
    setPending(true);
    try {
      await zoomWebPage(getUrl(), action);
    } catch (error) {
      toaster.toast({ title: '网页缩放失败', body: String(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <header
      aria-label="网页标题与缩放"
      style={{
        position: 'absolute',
        zIndex: 7001,
        left: x,
        top: y,
        width,
        height: WEB_HEADER_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        background: '#252b35',
        color: '#fff',
        font: '14px sans-serif',
      }}
    >
      <span
        title={title}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
        }}
      >
        {title || '正在加载…'}
      </span>
      {(
        [
          ['smaller', '缩小'],
          ['default', '默认'],
          ['larger', '放大'],
        ] as const
      ).map(([action, label]) => (
        <button
          key={action}
          type="button"
          aria-label={label}
          title={label}
          disabled={pending}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void zoom(action)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 28,
            padding: 4,
            flexShrink: 0,
            border: 0,
            borderRadius: 4,
            background: '#435268',
            color: '#fff',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={icons[action]} />
          </svg>
        </button>
      ))}
    </header>
  );
};

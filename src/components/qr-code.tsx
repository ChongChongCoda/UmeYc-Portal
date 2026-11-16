import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export const QrCode = ({ value }: { value: string }) => {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const modules: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (code.isDark(row, column)) modules.push(`M${column + 4},${row + 4}h1v1h-1z`);
      }
    }
    return { size: count + 8, path: modules.join('') };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label="扫码输入网址二维码"
      viewBox={`0 0 ${size} ${size}`}
      width={212}
      height={212}
      style={{ display: 'block', margin: '12px auto' }}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
};

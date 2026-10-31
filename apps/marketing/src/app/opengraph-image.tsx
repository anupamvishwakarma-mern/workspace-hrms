import { ImageResponse } from 'next/og';
import { brand } from '@/config/brand';

export const alt = `${brand.name}: ${brand.description}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background: brand.colors.secondary,
        color: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background: brand.colors.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          {brand.logoMark}
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>{brand.name}</div>
      </div>
      <div style={{ marginTop: 48, fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>
        Manage your entire workforce in one place.
      </div>
      <div style={{ marginTop: 28, fontSize: 30, color: brand.colors.accent }}>{brand.tagline}</div>
    </div>,
    size,
  );
}

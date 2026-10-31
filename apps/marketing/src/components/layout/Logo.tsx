import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@/config/brand';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 font-bold tracking-tight ${className}`}
      aria-label={`${brand.name} home`}
    >
      {brand.logoImage ? (
        <Image src={brand.logoImage} alt="" width={32} height={32} priority />
      ) : (
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        >
          {brand.logoMark}
        </span>
      )}
      <span className="text-lg">{brand.name}</span>
    </Link>
  );
}

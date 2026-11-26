import { cn } from '@/lib/cn';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  // false shows only the chilli mark (compact spots).
  showWordmark?: boolean;
  className?: string;
}

const sizes = {
  sm: 'w-40',
  md: 'w-52',
  lg: 'w-72',
};

const markSizes = {
  sm: 'w-8',
  md: 'w-10',
  lg: 'w-14',
};

// Generated from assets/brand/brandchilly-logo-transparent.png by `npm run brand:assets`.
export function BrandLogo({ size = 'md', showWordmark = true, className }: BrandLogoProps) {
  const base = import.meta.env.BASE_URL;
  return (
    <div className={cn('flex items-center', className)}>
      {showWordmark ? (
        <img
          src={`${base}assets/images/brandchilly-logo.webp`}
          alt="BrandChilly"
          width={720}
          height={238}
          className={cn('h-auto object-contain', sizes[size])}
        />
      ) : (
        <img
          src={`${base}assets/images/brandchilly-mark.webp`}
          alt="BrandChilly"
          width={128}
          height={128}
          className={cn('h-auto object-contain', markSizes[size])}
        />
      )}
    </div>
  );
}

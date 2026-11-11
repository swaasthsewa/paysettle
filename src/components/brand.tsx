/**
 * The PaySettle mark: two strands — client and provider — that start apart and close into one ring around a tick.
 * The signature visual of the product (the "settle ring"): agreement first, money second. Decorative beside the name.
 */
export function BrandMark({ height = 28 }: { height?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" width={height} height={height} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ps-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0d9488" /><stop offset="1" stopColor="#14b8a6" /></linearGradient>
        <linearGradient id="ps-b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f59e0b" /><stop offset="1" stopColor="#f97316" /></linearGradient>
      </defs>
      <path d="M20 4a16 16 0 0 0 0 32" fill="none" stroke="url(#ps-a)" strokeWidth="5" strokeLinecap="round" />
      <path d="M20 36a16 16 0 0 0 0-32" fill="none" stroke="url(#ps-b)" strokeWidth="5" strokeLinecap="round" />
      <path d="M13.5 20.5l4.5 4.5 8.5-9" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

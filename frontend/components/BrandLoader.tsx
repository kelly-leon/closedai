export function BrandLoader({ className = "" }: { className?: string }) {
  return (
    <div className={`brand-loader ${className}`} role="status">
      <span className="sr-only">Loading ClosedAI</span>
      <span className="brand-loader-mark" aria-hidden="true">
        ClosedAI
        <span className="brand-loader-ring">
          <span className="brand-loader-dot" />
        </span>
      </span>
    </div>
  );
}

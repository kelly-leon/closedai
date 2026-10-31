export default function DocumentsLoading() {
  return <div className="p-8" role="status" aria-label="Loading documents">
    <div className="h-10 w-48 animate-pulse rounded-lg bg-white/10" />
    <div className="mt-6 h-32 animate-pulse rounded-xl bg-white/10" />
    <div className="mt-8 space-y-3">{[0, 1, 2].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-white/10" />)}</div>
  </div>;
}

export default function ChatLoading() {
  return <div className="flex h-full flex-col gap-5 p-6" role="status" aria-label="Loading conversation">
    <div className="ml-auto h-16 w-2/3 animate-pulse rounded-2xl bg-white/10" />
    <div className="h-28 w-4/5 animate-pulse rounded-2xl bg-white/10" />
  </div>;
}

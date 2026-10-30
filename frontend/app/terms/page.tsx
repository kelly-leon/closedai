export default function TermsPage() {
  return <main className="min-h-screen bg-slate-950 text-white"><div className="mx-auto max-w-3xl px-5 py-10">
    <h1 className="text-4xl font-bold">Terms</h1>
    <article className="mt-8 space-y-6 text-lg leading-8 text-slate-200 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-white">
      <p>ClosedAI helps you study documents you upload. Review generated answers against your source material.</p>
      <h2>Your account and content</h2>
      <p>We collect and store your name, email, uploaded files, chat history, and usage needed to operate the service. You remain responsible for content you upload and how you use generated answers.</p>
      <h2>AI processing</h2>
      <p>Your files are not used to train ClosedAI models. Relevant text and chat context are sent to the configured AI provider to generate answers.</p>
      <h2>Service availability</h2>
      <p>This service is evolving and may be changed or unavailable while features are improved.</p>
    </article>
  </div></main>;
}

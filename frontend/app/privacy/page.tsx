export default function PrivacyPage() {
  return <LegalPage title="Privacy">
    <p>ClosedAI collects your name, email address, uploaded files, chat history, and usage information such as document and token counts.</p>
    <h2>AI processing</h2>
    <p>Your files are not used to train ClosedAI models. Relevant uploaded text and chat context are sent to the configured AI provider to answer your questions.</p>
    <h2>Payments</h2>
    <p>Manual M-Pesa payment requests include the package, amount, and transaction code. Awards are reviewed manually and can take 30 to 60 minutes after verification.</p>
    <h2>Deletion</h2>
    <p>You can request deletion of your account and associated data by contacting the service operator.</p>
  </LegalPage>;
}

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-950 text-white"><div className="mx-auto max-w-3xl px-5 py-10">
    <div role="note" className="mb-8 rounded-lg border border-amber-300/50 bg-amber-950/70 p-4 font-semibold text-amber-100">Draft, review before launch</div>
    <h1 className="text-4xl font-bold">{title}</h1>
    <article className="mt-8 space-y-6 text-lg leading-8 text-slate-200 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-white">{children}</article>
  </div></main>;
}

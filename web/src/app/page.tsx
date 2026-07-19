import Link from "next/link";

const SAMPLE_CARD = {
  name: "Moon Bakery Orders Agent",
  description: "Place and track orders at Moon Bakery.",
  url: "https://moonbakery-orders.aws.example.com",
  version: "1.0",
  capabilities: { streaming: false, pushNotifications: false },
  authentication: { schemes: ["Bearer"] },
  skills: [
    { name: "placeOrder", description: "Place a new bakery order" },
    { name: "trackOrder", description: "Track an existing order status" },
  ],
  provider: { organization: "Moon Bakery", url: "https://moonbakery.com" },
  _meta: {
    identifier: "urn:ai:domain:moonbakery.com:agent:orders",
    publicUrl: "https://agentcards.host39.org/moonbakery.com/orders.json",
    hostedBy: "host39.org",
  },
};

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs uppercase tracking-[0.22em] text-slate-500 shadow-sm">
            Agent Card Hosting
          </div>
          <h1 className="font-serif text-5xl italic leading-tight tracking-tight text-slate-950 sm:text-6xl">
            host your agents
            <br />
            <span className="text-slate-400">at predictable URLs</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            host39 is a third-party A2A agent card host. Register your identity, create agent cards,
            and publish them at stable public URLs — no server required.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/login"
              className="rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              Get started free
            </Link>
            <Link
              href="/dashboard"
              className="rounded-2xl border border-black/10 bg-white px-6 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          How it works
        </h2>
        <p className="mb-8 font-serif text-3xl italic text-slate-950">
          Three steps to publish your agent
        </p>

        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Register",
              desc: "Create an account with your email or a domain identity (for businesses). Domain users get URLs like /moonbakery.com/orders.json.",
            },
            {
              step: "02",
              title: "Create a card",
              desc: "Fill in your agent name, runtime URL, capabilities, authentication, and skills using our guided form.",
            },
            {
              step: "03",
              title: "Share the URL",
              desc: "Your card is live at a stable public URL. Register it with the NANDA Index so resolvers can find your agent by identity.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm"
            >
              <span className="font-mono text-xs text-slate-400">{item.step}</span>
              <h3 className="mt-2 text-xl font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* URL patterns */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          URL patterns
        </h2>
        <p className="mb-8 font-serif text-3xl italic text-slate-950">
          Predictable, stable, public
        </p>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Business / Domain</p>
            <code className="mt-3 block rounded-xl border border-black/5 bg-slate-50 p-4 font-mono text-sm text-slate-800">
              /moonbakery.com/orders.json
            </code>
            <p className="mt-3 text-sm text-slate-600">
              Register with a domain identity to get clean, branded URLs for your business agents.
            </p>
          </div>
          <div className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Personal / Email</p>
            <code className="mt-3 block rounded-xl border border-black/5 bg-slate-50 p-4 font-mono text-sm text-slate-800">
              /personal/john@hotmail.com/card.json
            </code>
            <p className="mt-3 text-sm text-slate-600">
              Register with your email for personal agent cards — great for developers and individuals.
            </p>
          </div>
        </div>
      </section>

      {/* Sample agent card */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
          A2A Agent Card format
        </h2>
        <p className="mb-8 font-serif text-3xl italic text-slate-950">
          Standard JSON, served instantly
        </p>

        <div className="overflow-x-auto rounded-3xl border border-black/10 bg-slate-950 p-6 shadow-sm">
          <pre className="font-mono text-sm leading-6 text-slate-200">
            {JSON.stringify(SAMPLE_CARD, null, 2)}
          </pre>
        </div>
      </section>
    </>
  );
}

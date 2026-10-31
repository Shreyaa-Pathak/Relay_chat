import { Button } from "../../components/ui/Button";
import { Wordmark } from "../../components/Wordmark";

export function LoadingScreen() {
  return (
    <main className="flex min-h-full items-center justify-center" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Wordmark className="text-5xl" />
        <p className="text-ink-muted" role="status">
          Restoring your session…
        </p>
      </div>
    </main>
  );
}

export function SetupScreen({ issues, onRetry }: { issues: { variable: string; message: string }[]; onRetry: () => void }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <section className="w-full max-w-xl rounded-3xl border-2 border-ink bg-paper p-6 shadow-sticker">
        <Wordmark className="mb-4 text-4xl" />
        <h1 className="mb-2 text-2xl font-extrabold">The server needs configuration</h1>
        <p className="mb-4 text-ink-muted">Relay's server is running but can't start until these environment variables are set. Values are never shown here.</p>
        <ul className="mb-5 flex flex-col gap-2">
          {issues.map((i) => (
            <li key={i.variable} className="rounded-xl bg-surface px-3 py-2 text-sm">
              <code className="font-bold">{i.variable}</code>
              <span className="block text-ink-muted">{i.message}</span>
            </li>
          ))}
        </ul>
        <p className="mb-5 text-sm">
          Locally: copy <code>.env.example</code> to <code>.env</code>. On Vercel: Project Settings → Environment Variables, then redeploy. See <code>docs/DEPLOYMENT.md</code>.
        </p>
        <Button variant="primary" onClick={onRetry}>
          Check again
        </Button>
      </section>
    </main>
  );
}

export function UnreachableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border-2 border-ink bg-paper p-6 shadow-sticker">
        <Wordmark className="mb-4 text-4xl" />
        <h1 className="mb-2 text-2xl font-extrabold">Can't reach the Relay server</h1>
        <p className="mb-2 text-ink-muted">{message}</p>
        <p className="mb-5 text-sm">
          Running locally? Start everything with <code className="font-bold">pnpm dev</code> and make sure Postgres is up (<code>docker compose up -d</code>).
        </p>
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </section>
    </main>
  );
}

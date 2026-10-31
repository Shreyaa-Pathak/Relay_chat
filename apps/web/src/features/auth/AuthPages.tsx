import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { LIMITS } from "@relay/shared";
import { ApiError } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Wordmark } from "../../components/Wordmark";
import { useAuth } from "./AuthContext";

function Field({ label, id, error, ...rest }: { label: string; id: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-11 rounded-xl border-2 border-ink bg-paper px-3 text-[15px] placeholder:text-ink-muted aria-invalid:border-dashed"
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}

function AuthLayout({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-1 text-6xl" />
        <p className="mb-8 text-ink-muted">Real-time chat your community owns.</p>
        <section aria-labelledby="auth-title" className="rounded-3xl border-2 border-ink bg-paper p-6 shadow-sticker">
          <h1 id="auth-title" className="mb-5 text-2xl font-extrabold tracking-tight">
            {title}
          </h1>
          {children}
        </section>
        <p className="mt-5 text-center text-sm">{footer}</p>
      </div>
    </main>
  );
}

function useAfterAuth() {
  const loc = useLocation() as { state?: { from?: string } };
  return loc.state?.from ?? "/c/general";
}

export function LoginPage() {
  const { state, signIn } = useAuth();
  const to = useAfterAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status === "signedIn") return <Navigate to={to} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn(String(f.get("email")), String(f.get("password")));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-bold underline underline-offset-2">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" id="email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" id="password" name="password" type="password" autoComplete="current-password" required />
        {error && (
          <p role="alert" className="rounded-xl bg-blush px-3 py-2 text-sm font-semibold">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="justify-center">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { state, register } = useAuth();
  const to = useAfterAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  if (state.status === "signedIn") return <Navigate to={to} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password.length < LIMITS.passwordMin) {
      setFieldErrors({ password: `Use at least ${LIMITS.passwordMin} characters` });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(String(f.get("email")), password, String(f.get("displayName")));
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const fe: Record<string, string> = {};
        for (const d of err.details as { path: string; message: string }[]) fe[d.path] ??= d.message;
        setFieldErrors(fe);
      }
      setError(err instanceof ApiError ? err.message : "Couldn't create the account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have one?{" "}
          <Link to="/login" className="font-bold underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Display name" id="displayName" name="displayName" autoComplete="nickname" maxLength={LIMITS.displayNameMax} required error={fieldErrors.displayName} />
        <Field label="Email" id="email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} />
        <Field
          label="Password"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={LIMITS.passwordMin}
          required
          error={fieldErrors.password}
          placeholder={`At least ${LIMITS.passwordMin} characters`}
        />
        {error && !Object.keys(fieldErrors).length && (
          <p role="alert" className="rounded-xl bg-blush px-3 py-2 text-sm font-semibold">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="justify-center">
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}

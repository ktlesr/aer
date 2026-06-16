"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SealMark } from "@/components/brand";
import { loginAction, signupAction, googleAction, type FormState } from "@/lib/auth/actions";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export function AuthForm({
  mode,
  googleEnabled,
}: {
  mode: "login" | "signup";
  googleEnabled: boolean;
}) {
  const isSignup = mode === "signup";
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    isSignup ? signupAction : loginAction,
    {},
  );

  return (
    <div className="animate-rise w-full max-w-sm" style={{ animationDelay: "120ms" }}>
      {/* Brand mark — visible on mobile where the evidence aside is hidden. */}
      <div className="mb-7 flex items-center gap-2.5 lg:hidden">
        <SealMark className="size-7" />
        <span className="font-display text-[0.98rem] font-semibold tracking-[-0.01em]">
          Agent Evidence Recorder
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card p-7">
        <header className="mb-6">
          <p className="eyebrow">{isSignup ? "Create account" : "Welcome back"}</p>
          <h1 className="mt-2.5 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.02em]">
            {isSignup ? "Start recording evidence" : "Sign in"}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {isSignup
              ? "Your own workspace — only you see your runs."
              : "Access your agent runs and audit packets."}
          </p>
        </header>

        {googleEnabled ? (
          <>
            <form action={googleAction}>
              <Button type="submit" variant="outline" size="lg" className="w-full">
                <GoogleGlyph />
                Continue with Google
              </Button>
            </form>
            <div className="my-5 flex items-center gap-3 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

        <form action={formAction} className="space-y-3.5">
          {isSignup ? (
            <Field id="name" label="Name" optional>
              <Input id="name" name="name" autoComplete="name" placeholder="Jane Doe" />
            </Field>
          ) : null}

          <Field id="email" label="Email">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </Field>

          <Field id="password" label="Password">
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
            />
          </Field>

          {state.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {state.error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
            {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </Button>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="font-mono text-[0.62rem] font-medium uppercase tracking-[0.16em] text-muted-foreground"
      >
        {label}
        {optional ? <span className="ml-1 opacity-60">optional</span> : null}
      </label>
      {children}
    </div>
  );
}

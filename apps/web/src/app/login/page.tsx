"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/Mark";
import { safeNext } from "@/lib/safe-next";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Supabase sends 6-digit codes by default; projects can set up to 10. */
const CODE_MIN = 6;
const CODE_MAX = 10;
/** Supabase won't send another email to the same address within a minute. */
const RESEND_AFTER = 60;
/** Google sign-in needs the Google provider switched on in Supabase first; until then the button would lead to an error page. */
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "1";

/**
 * How the code is checked depends on how it was sent: a guest attaching an email to their
 * account (so their trips come with them) confirms an email change; everyone else signs in.
 */
type CodeKind = "email" | "email_change";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<{ email: string; kind: CodeKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(
    params.get("error") ? { text: "That sign-in link didn't work or has expired. Send yourself a new one below.", err: true } : null,
  );
  const codeRef = useRef<HTMLInputElement>(null);
  const sb = supabaseBrowser();

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(addr: string) {
    setBusy(true);
    setMsg(null);
    // The emailed button lands on /auth/confirm, which signs in on whichever device opens it.
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const otp = () => sb.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true, emailRedirectTo: redirect } });
    // A guest who signs in keeps their trips: attach the email to the guest account.
    // If that email already has an account, sign in to that account instead.
    const { data: current } = await sb.auth.getUser();
    let kind: CodeKind = "email";
    let error: { message: string } | null = null;
    if (current.user?.is_anonymous) {
      const linked = await sb.auth.updateUser({ email: addr }, { emailRedirectTo: redirect });
      if (linked.error) error = (await otp()).error;
      else kind = "email_change";
    } else {
      error = (await otp()).error;
    }
    setBusy(false);
    if (error) {
      const tooSoon = /security purposes|rate limit|after \d+ seconds/i.test(error.message);
      return setMsg({ text: tooSoon ? "We just sent you an email. Wait a minute before asking for another." : error.message, err: true });
    }
    setSentTo({ email: addr, kind });
    setCode("");
    setWait(RESEND_AFTER);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function verify(token: string) {
    if (!sentTo || busy) return;
    setBusy(true);
    setMsg(null);
    const { error } = await sb.auth.verifyOtp({ email: sentTo.email, token, type: sentTo.kind });
    if (error) {
      setBusy(false);
      return setMsg({ text: "That code didn't work. It may have expired: check it, or send a new one.", err: true });
    }
    router.push(next);
    router.refresh();
  }

  async function google() {
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  return (
    <div className="card login">
      <div className="head">
        <Mark width={76} tight className="card-mark" />
        <h1>{sentTo ? "Check your email" : "Sign in"}</h1>
        <p className="lede">
          {sentTo ? (
            <>
              We sent a code to <b>{sentTo.email}</b>. Enter it here, or tap the button in the email to sign in on that device.
            </>
          ) : (
            "Optional. Signing in keeps your trips and source mix across devices and browsers."
          )}
        </p>
      </div>
      {!sentTo ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send(email.trim());
          }}
        >
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn" disabled={busy || !email.includes("@")}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <div className="field">
            <label className="label" htmlFor="code">
              Code
            </label>
            <input
              id="code"
              ref={codeRef}
              className="code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_MAX}
              placeholder="••••••"
              required
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, CODE_MAX);
                setCode(v);
                // A pasted or autofilled code signs straight in.
                if (v.length >= CODE_MIN && v.length - code.length > 1) void verify(v);
              }}
            />
          </div>
          <button className="btn" disabled={busy || code.length < CODE_MIN}>
            {busy ? "Checking…" : "Sign in"}
          </button>
          <div className="login-links">
            <button type="button" className="linkbtn" disabled={busy || wait > 0} onClick={() => void send(sentTo.email)}>
              {wait > 0 ? `Send another in ${wait}s` : "Send a new code"}
            </button>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setMsg(null);
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
      {!sentTo && GOOGLE && (
        <button className="btn ghost" onClick={google}>
          Continue with Google
        </button>
      )}
      <p className={`status${msg?.err ? " err" : ""}`} role="status" aria-live="polite">
        {msg?.text}
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

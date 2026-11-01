"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(params.get("error") ? { text: "That sign-in link didn't work. Try again.", err: true } : null);
  const sb = supabaseBrowser();

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setBusy(false);
    if (error) return setMsg({ text: error.message, err: true });
    setSent(true);
    setMsg({ text: `We emailed a sign-in link to ${email}. Open it in this browser to finish signing in.` });
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setMsg({ text: "That code didn't work. Check it, or send a new one.", err: true });
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
    <div className="card">
      <div className="head">
        <h1>Sign in</h1>
        <p className="lede">Sign in to build trips, keep your history, and set your own source mix.</p>
      </div>
      {!sent ? (
        <form className="stack" onSubmit={sendCode}>
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn" disabled={busy || !email}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          <div className="field">
            <label className="label" htmlFor="code">Or enter the code, if your email has one</label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          <button className="btn" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="linkbtn" onClick={() => { setSent(false); setCode(""); setMsg(null); }}>Use a different email</button>
        </form>
      )}
      <button className="btn ghost" onClick={google}>Continue with Google</button>
      <p className={`status${msg?.err ? " err" : ""}`} role="status">{msg?.text}</p>
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

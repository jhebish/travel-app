import { useEffect, useState } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { TextInput } from "react-native";
import { supabase } from "../src/supabase";
import { useTheme } from "../src/theme";
import { Button, Card, H1, Label, P, Screen, Status } from "../src/ui";

/** Supabase sends 6-digit codes by default; projects can set up to 10. */
const CODE_MIN = 6;
const CODE_MAX = 10;
const RESEND_AFTER = 60;

/** A guest attaching an email confirms an email change; everyone else signs in. */
type CodeKind = "email" | "email_change";

export default function Login() {
  const t = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<{ email: string; kind: CodeKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const input = { backgroundColor: t.bg, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, color: t.ink };

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(addr: string) {
    setBusy(true);
    setMsg(null);
    // The button in the email opens the app at /auth-callback, which finishes sign-in.
    const redirect = Linking.createURL("auth-callback");
    const otp = () => supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true, emailRedirectTo: redirect } });
    // A guest keeps their trips by attaching the email to the guest account;
    // if that email already has an account, sign in to it instead.
    const { data: current } = await supabase.auth.getUser();
    let kind: CodeKind = "email";
    let error: { message: string } | null = null;
    if (current.user?.is_anonymous) {
      const linked = await supabase.auth.updateUser({ email: addr }, { emailRedirectTo: redirect });
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
  }

  async function verify(token: string) {
    if (!sentTo || busy) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: sentTo.email, token, type: sentTo.kind });
    setBusy(false);
    // Supabase says "expired or invalid" for both, so the message covers both.
    if (error) return setMsg({ text: "That code didn't work. It may have expired: check it, or send a new one.", err: true });
    router.replace("/");
  }

  return (
    <Screen>
      <Card>
        <H1>{sentTo ? "Check your email" : "Sign in"}</H1>
        <P muted>
          {sentTo ? `We sent a code to ${sentTo.email}. Enter it here.` : "Optional. Signing in keeps your trips and source mix across devices."}
        </P>
        {!sentTo ? (
          <>
            <Label>Email</Label>
            <TextInput style={input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholderTextColor={t.muted} placeholder="you@example.com" />
            <Button title={busy ? "Sending…" : "Email me a code"} disabled={busy || !email.includes("@")} onPress={() => void send(email.trim())} />
          </>
        ) : (
          <>
            <Label>Code</Label>
            <TextInput
              style={[input, { fontSize: 26, letterSpacing: 8, textAlign: "center" }]}
              value={code}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, "").slice(0, CODE_MAX);
                setCode(digits);
                // The code the keyboard offers from Mail fills in all at once: sign straight in.
                if (digits.length >= CODE_MIN && digits.length - code.length > 1) void verify(digits);
              }}
              keyboardType="number-pad"
              maxLength={CODE_MAX}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
            />
            <Button title={busy ? "Checking…" : "Sign in"} disabled={busy || code.length < CODE_MIN} onPress={() => void verify(code)} />
            <Button ghost title={wait > 0 ? `Send another in ${wait}s` : "Send a new code"} disabled={busy || wait > 0} onPress={() => void send(sentTo.email)} />
            <Button ghost title="Use a different email" onPress={() => { setSentTo(null); setCode(""); setMsg(null); }} />
          </>
        )}
        <Status text={msg?.text} err={msg?.err} />
      </Card>
    </Screen>
  );
}

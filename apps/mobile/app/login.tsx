import { useState } from "react";
import { TextInput } from "react-native";
import { supabase } from "../src/supabase";
import { useTheme } from "../src/theme";
import { Button, Card, H1, Label, P, Screen, Status } from "../src/ui";

export default function Login() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const input = { backgroundColor: t.bg, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, color: t.ink };

  async function send() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setMsg({ text: error.message, err: true });
    setSent(true);
    setMsg({ text: `We sent a 6-digit code to ${email.trim()}.` });
  }
  async function verify() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setMsg({ text: "That code didn't work. Check it, or send a new one.", err: true });
  }

  return (
    <Screen>
      <Card>
        <H1>Sign in</H1>
        <P muted>Sign in to build trips, keep your history, and set your own source mix.</P>
        {!sent ? (
          <>
            <Label>Email</Label>
            <TextInput style={input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholderTextColor={t.muted} placeholder="you@example.com" />
            <Button title={busy ? "Sending…" : "Email me a code"} disabled={busy || !email.includes("@")} onPress={send} />
          </>
        ) : (
          <>
            <Label>6-digit code</Label>
            <TextInput style={input} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="one-time-code" />
            <Button title={busy ? "Checking…" : "Sign in"} disabled={busy || code.length < 6} onPress={verify} />
            <Button ghost title="Use a different email" onPress={() => { setSent(false); setCode(""); setMsg(null); }} />
          </>
        )}
        <Status text={msg?.text} err={msg?.err} />
      </Card>
    </Screen>
  );
}


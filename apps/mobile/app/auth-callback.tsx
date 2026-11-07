import type { EmailOtpType } from "@supabase/supabase-js";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../src/supabase";
import { Button, Card, Loading, Screen, Status } from "../src/ui";

const TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "email_change"]);

/**
 * Target of the button in the sign-in email. pylos.ai/auth/confirm hands it on as
 * tripplanner://auth-callback?token_hash=…&type=…; older links carry ?code=… instead.
 */
export default function AuthCallback() {
  const { code, token_hash, type, error_description } = useLocalSearchParams<{ code?: string; token_hash?: string; type?: string; error_description?: string }>();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(error_description ?? null);

  useEffect(() => {
    const done = ({ error }: { error: unknown }) => {
      if (error) setErr("That sign-in link has expired or was already used. Enter the code from the email, or request a new one.");
      else router.replace("/");
    };
    if (token_hash && type && TYPES.has(type as EmailOtpType)) {
      supabase.auth.verifyOtp({ token_hash, type: type as EmailOtpType }).then(done);
    } else if (code) {
      supabase.auth.exchangeCodeForSession(code).then(done);
    } else if (!error_description) {
      setErr("That sign-in link is missing its code. Request a new one.");
    }
  }, [code, token_hash, type, error_description, router]);

  return (
    <Screen>
      <Card>
        {err ? (
          <>
            <Status text={err} err />
            <Button title="Back to sign in" onPress={() => router.replace("/login")} />
          </>
        ) : (
          <Loading text="Signing you in…" />
        )}
      </Card>
    </Screen>
  );
}

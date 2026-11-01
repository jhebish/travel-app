import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../src/supabase";
import { Button, Card, Loading, Screen, Status } from "../src/ui";

/** Target of the emailed sign-in link (tripplanner://auth-callback?code=...). */
export default function AuthCallback() {
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(error_description ?? null);

  useEffect(() => {
    if (!code) {
      if (!error_description) setErr("That sign-in link is missing its code. Request a new one.");
      return;
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setErr("That sign-in link has expired or was already used. Request a new one.");
      else router.replace("/");
    });
  }, [code, error_description, router]);

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

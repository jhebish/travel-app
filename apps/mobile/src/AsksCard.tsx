import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { api } from "./api";
import { Button, Card, H2, P } from "./ui";

/** On the You tab: questions friends asked you about places you've been (app/friends.tsx). */
export function AsksCard() {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      api<{ open: number }>("/api/asks/count")
        .then((r) => setOpen(r.open))
        .catch(() => setOpen(null));
    }, []),
  );
  return (
    <Card>
      <H2>Friends&apos; questions</H2>
      <P muted>{open ? `${open} ${open === 1 ? "friend is" : "friends are"} waiting for your favourites.` : "Answer friends who ask about a city you've been to, and see the answers to yours."}</P>
      <Button ghost title={open ? "Answer" : "Open"} onPress={() => router.push("/friends")} />
    </Card>
  );
}

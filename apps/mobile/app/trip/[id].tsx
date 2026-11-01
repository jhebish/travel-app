import type { Trip } from "@travel/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { api } from "../../src/api";
import { TripView } from "../../src/TripView";
import { Loading, Screen, Status } from "../../src/ui";

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    api<{ trip: Trip }>(`/api/trips/${id}`)
      .then((r) => setTrip(r.trip))
      .catch((e) => setErr((e as Error).message));
  }, [id]);
  return <Screen>{err ? <Status text={err} err /> : trip ? <TripView trip={trip} /> : <Loading text="Loading trip…" />}</Screen>;
}

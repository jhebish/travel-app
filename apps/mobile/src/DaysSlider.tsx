import Slider from "@react-native-community/slider";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTheme } from "./theme";
import { Label, Text } from "./ui";

/**
 * "How many days?" The number follows the thumb; the itinerary below changes when it's let go,
 * so dragging stays smooth.
 */
export function DaysSlider({ value, min, max, onChange, note }: { value: number; min: number; max: number; onChange: (n: number) => void; note?: string }) {
  const t = useTheme();
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  if (max <= min) return null;
  const words = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>How many days?</Label>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{words(shown)}</Text>
      </View>
      <Slider
        style={{ height: 40 }}
        minimumValue={min}
        maximumValue={max}
        step={1}
        value={value}
        minimumTrackTintColor={t.accent}
        maximumTrackTintColor={t.line}
        thumbTintColor={t.accent}
        accessibilityLabel="How many days"
        accessibilityValue={{ min, max, now: shown, text: words(shown) }}
        onValueChange={(v) => setShown(Math.round(v))}
        onSlidingComplete={(v) => onChange(Math.round(v))}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.muted, fontSize: 14 }}>{min}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>{max}</Text>
      </View>
      {note ? <Text style={{ color: t.muted, fontSize: 15, fontStyle: "italic" }}>{note}</Text> : null}
    </View>
  );
}

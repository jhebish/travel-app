import Slider from "@react-native-community/slider";
import { SOURCES, defaultWeights, type AppConfigDTO, type PrefsDTO } from "@travel/core";
import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api } from "../../src/api";
import { useTheme } from "../../src/theme";
import { Button, Card, H1, Loading, P, Screen, Status, styles, Text } from "../../src/ui";

export default function Sources() {
  const t = useTheme();
  const [config, setConfig] = useState<AppConfigDTO | null>(null);
  const [prefs, setPrefs] = useState<PrefsDTO>({ useCustom: false, weights: defaultWeights(), blocked: [] });
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  useEffect(() => {
    Promise.all([api<{ config: AppConfigDTO }>("/api/config"), api<{ prefs: PrefsDTO | null }>("/api/prefs")])
      .then(([c, p]) => {
        setConfig(c.config);
        setPrefs(p.prefs ?? { useCustom: false, weights: c.config.weights, blocked: [] });
      })
      .catch((e) => setMsg({ text: (e as Error).message, err: true }));
  }, []);

  async function save() {
    setMsg({ text: "Saving…" });
    try {
      await api("/api/prefs", { method: "PUT", json: prefs });
      setMsg({ text: "Saved. Your next trips use this mix." });
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
    }
  }

  if (!config) return <Screen><Loading text="Loading sources…" /><Status text={msg?.text} err={msg?.err} /></Screen>;
  const shown = prefs.useCustom ? prefs : { ...prefs, weights: config.weights, blocked: [] };

  return (
    <Screen>
      <Card>
        <H1>My source mix</H1>
        <P muted>Choose how heavily your trips lean on each kind of source.</P>
        <View style={[styles.row, { justifyContent: "space-between", backgroundColor: t.bg, borderRadius: 12, padding: 12 }]}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: t.ink, fontWeight: "700" }}>Use my own mix</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{prefs.useCustom ? "On: your trips use the weights below." : "Off: your trips follow the app's defaults."}</Text>
          </View>
          <Switch
            value={prefs.useCustom}
            onValueChange={(useCustom) => setPrefs({ ...prefs, useCustom, weights: prefs.useCustom ? prefs.weights : { ...config.weights, ...prefs.weights } })}
          />
        </View>
        {SOURCES.map((s, i) => {
          const locked = config.blocked.includes(s.id);
          const blocked = locked || shown.blocked.includes(s.id);
          const w = locked ? 0 : (shown.weights[s.id] ?? s.defaultWeight);
          return (
            <View key={s.id} style={{ gap: 6, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderColor: t.line, opacity: blocked ? 0.5 : 1 }}>
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <View style={styles.row}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.sources[s.id] }} />
                  <Text style={{ color: t.ink, fontWeight: "700" }}>{s.name}</Text>
                </View>
                {locked ? (
                  <Text style={{ color: t.bad, fontSize: 12, fontWeight: "600" }}>Blocked by the app</Text>
                ) : (
                  <Pressable
                    disabled={!prefs.useCustom}
                    onPress={() => setPrefs({ ...prefs, blocked: blocked ? prefs.blocked.filter((b) => b !== s.id) : [...prefs.blocked, s.id] })}
                  >
                    <Text style={{ color: t.accent, fontSize: 13, fontWeight: "600" }}>{blocked ? "Unblock" : "Block"}</Text>
                  </Pressable>
                )}
              </View>
              <Text style={{ color: t.muted, fontSize: 13 }}>{s.description}</Text>
              <View style={styles.row}>
                <Slider
                  style={{ flex: 1, height: 36 }}
                  minimumValue={0}
                  maximumValue={10}
                  step={1}
                  value={w}
                  disabled={!prefs.useCustom || locked}
                  minimumTrackTintColor={t.accent}
                  maximumTrackTintColor={t.line}
                  accessibilityLabel={`Weight for ${s.name}`}
                  onSlidingComplete={(v) => setPrefs({ ...prefs, weights: { ...prefs.weights, [s.id]: Math.round(v) } })}
                />
                <Text style={{ color: t.ink, fontFamily: "Menlo", width: 44, textAlign: "right" }}>{w}/10</Text>
              </View>
            </View>
          );
        })}
        <Button title="Save my mix" onPress={save} />
        <Button ghost title="Reset to defaults" disabled={!prefs.useCustom} onPress={() => setPrefs({ useCustom: false, weights: config.weights, blocked: [] })} />
        <Status text={msg?.text} err={msg?.err} />
      </Card>
    </Screen>
  );
}

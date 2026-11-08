import Ionicons from "@expo/vector-icons/Ionicons";
import { MAX_PLACE_PHOTOS, type PlacePhoto as Photo, type PlaceVerification } from "@travel/core";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { FlatList, Linking, Modal, Pressable, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONT } from "./theme";
import { Text } from "./ui";

const WEB = (process.env.EXPO_PUBLIC_API_URL ?? "https://www.pylos.ai").replace(/\/$/, "");
/** The site's photo route: redirects to Google's image and falls back when a photo name expires. */
export const photoUri = (name: string, w: number) => `${WEB}/api/photo?ref=${encodeURIComponent(name)}&w=${w}`;

const INK = "#f6f0e8";

/**
 * A Google Maps photo of a place. Tapping it opens the gallery. The author is credited on the
 * photo, as Google requires wherever its photos are shown.
 */
export function PlacePhoto({ photo, alt, onOpen, count, style }: { photo?: Photo; alt: string; onOpen?: () => void; count?: number; style?: ViewStyle }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return null;
  return (
    <Pressable
      onPress={onOpen}
      disabled={!onOpen}
      accessibilityRole={onOpen ? "imagebutton" : "image"}
      accessibilityLabel={onOpen ? `See photos of ${alt}` : alt}
      style={[{ borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(127,127,127,0.15)" }, style]}
    >
      <Image source={{ uri: photoUri(photo.name, 800) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} onError={() => setFailed(true)} />
      {count != null && (
        <View style={{ position: "absolute", top: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(23,18,15,0.6)", borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 }}>
          <Ionicons name="images-outline" size={13} color="#fff" />
          {count > 1 && <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "600" }}>{count}</Text>}
        </View>
      )}
      {!!photo.by && (
        <Text numberOfLines={1} style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4, fontSize: 11.5, color: "#fff", backgroundColor: "rgba(0,0,0,0.35)" }}>
          {photo.by} · Google Maps
        </Text>
      )}
    </Pressable>
  );
}

export interface GalleryTarget {
  title: string;
  place?: PlaceVerification;
  /** Which photo was tapped. */
  start?: number;
}

/**
 * A place's photos full screen, one at a time: swipe between them. Trips built before galleries
 * kept only a few photos; for those it fetches the rest by place id.
 */
export function PhotoGallery({ target, onClose }: { target: GalleryTarget | null; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  // Each opening gets a fresh list, so it starts on the photo that was tapped.
  const [opening, setOpening] = useState(0);
  // Slides in a sideways list get no height of their own: size them to the space below the header.
  const [listH, setListH] = useState(0);

  useEffect(() => {
    if (!target) {
      setPhotos([]);
      return;
    }
    const stored = target.place?.photos ?? [];
    setPhotos(stored);
    setIndex(Math.min(target.start ?? 0, Math.max(stored.length - 1, 0)));
    setOpening((n) => n + 1);
    const id = target.place?.placeId;
    if (!id || stored.length >= MAX_PLACE_PHOTOS) return;
    let live = true;
    fetch(`${WEB}/api/place-photos?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ photos?: Photo[] }>) : null))
      .then((res) => {
        // The fresh list replaces the stored one: an old trip's photo names may have expired.
        if (live && res?.photos && res.photos.length > stored.length) setPhotos(res.photos);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);

  return (
    <Modal visible={!!target} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#17120f", paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 20, paddingRight: 12, paddingVertical: 10 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: INK, fontFamily: FONT.display, fontSize: 19 }}>
            {target?.title}
          </Text>
          {photos.length > 1 && <Text style={{ color: "rgba(246,240,232,0.66)", fontSize: 15, fontVariant: ["tabular-nums"] }}>{`${index + 1} of ${photos.length}`}</Text>}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photos"
            hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" }}
          >
            <Ionicons name="close" size={22} color={INK} />
          </Pressable>
        </View>
        <View style={{ flex: 1 }} onLayout={(e) => setListH(e.nativeEvent.layout.height)}>
        {!!photos.length && listH > 0 && (
          <FlatList
            key={`${opening}-${photos.length}`}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index, photos.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.name}
            onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            scrollEventThrottle={32}
            renderItem={({ item, index: n }) => (
              <View style={{ width, height: listH, paddingBottom: 34 }}>
                <Image
                  source={{ uri: photoUri(item.name, 1200) }}
                  style={{ flex: 1 }}
                  contentFit="contain"
                  transition={150}
                  accessibilityLabel={`${target?.title ?? "Place"}, photo ${n + 1} of ${photos.length}`}
                />
                {!!item.by && (
                  <Text
                    numberOfLines={1}
                    onPress={item.byUrl ? () => Linking.openURL(item.byUrl!).catch(() => {}) : undefined}
                    style={{ position: "absolute", left: 16, right: 16, bottom: 8, textAlign: "center", color: "rgba(246,240,232,0.7)", fontSize: 13.5 }}
                  >
                    {item.by} · Google Maps
                  </Text>
                )}
              </View>
            )}
          />
        )}
        </View>
      </View>
    </Modal>
  );
}

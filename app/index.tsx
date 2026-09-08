import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/theme/ThemeContext";
import { getToken } from "@/src/utils/authToken";
import { resumeRoute } from "@/src/utils/onboarding";

const SPLASH_BG =
  "https://static.prod-images.emergentagent.com/jobs/ad57d3a5-0066-4217-af01-a981f77ed10e/images/3aaee2b2f25053386a7dc86ee27194d3ead5308fa01ae8ad39f426e0ff785d7b.png";

export default function Splash() {
  const router = useRouter();
  const { colors } = useTheme();
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1.05, { duration: 700, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 350 }),
    );
    const t = setTimeout(async () => {
      // Restore a persisted session: if a JWT is already stored, go straight
      // into the app instead of forcing sign-in again. An expired/invalid
      // token is handled by apiClient's 401 interceptor (clears it + bounces
      // to /welcome), so we intentionally don't block on a network check here
      // — that keeps the app usable on spotty connectivity.
      const token = await getToken();
      // A token is not a finished account — it is issued at OTP, before the
      // name and PIN steps — so resumeRoute() decides where a restored session
      // actually belongs.
      router.replace((token ? await resumeRoute() : "/welcome") as never);
    }, 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  const tagStyle = useAnimatedStyle(() => ({
    opacity: withDelay(700, withTiming(1, { duration: 500 })),
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.primary }]} testID="splash-screen">
      <Image source={{ uri: SPLASH_BG }} style={styles.bg} blurRadius={0} resizeMode="cover" />
      <View style={styles.overlay} />
      <Animated.View style={[styles.content, animatedStyle]}>
        <View style={styles.logoCircle}>
          <Image
            source={require("@/assets/images/logo-mark.png")}
            style={styles.logoImg}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brand}>Chuma</Text>
      </Animated.View>
      <Animated.Text style={[styles.tagline, tagStyle]} testID="splash-tagline">
        Community Chuma, Digitally.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  bg: { ...StyleSheet.absoluteFill, opacity: 0.35 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(10, 92, 54, 0.55)" },
  content: { alignItems: "center" },
  logoCircle: {
    width: 165,
    height: 165,
    borderRadius: 48,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  logoImg: { width: 124, height: 124 },
  brand: { color: "#fff", fontSize: 38, fontWeight: "800", letterSpacing: -0.8 },
  tagline: {
    position: "absolute",
    bottom: 60,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    letterSpacing: 0.4,
    fontWeight: "500",
  },
});

import { Link } from "expo-router";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.badge}>DRINQ</Text>
        <Text style={styles.title}>Ops Companion</Text>
        <Text style={styles.subtitle}>
          Customers order through the web app. This Expo app is for optional venue and runner operations while parity is built out.
        </Text>
        <View style={styles.links}>
          <Link href="/(runner)" style={styles.link}>
            Runner
          </Link>
          <Link href="/(venue)" style={styles.link}>
            Venue
          </Link>
          <Link href="/(admin)" style={styles.link}>
            Admin
          </Link>
        </View>
        <Text style={styles.note}>
          Customer ordering, checkout, live tracking, and tipping are web-first in `apps/web`.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24
  },
  badge: {
    color: "#FF3B30",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12
  },
  title: { color: "#FFFFFF", fontSize: 34, fontWeight: "800", marginBottom: 10 },
  subtitle: {
    color: "#BDBDBD",
    fontSize: 16,
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 24,
    marginBottom: 24
  },
  links: { width: "100%", gap: 10, maxWidth: 360 },
  note: {
    marginTop: 18,
    color: "#8F98A3",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 20
  },
  link: {
    color: "#111111",
    backgroundColor: "#FFFFFF",
    textAlign: "center",
    paddingVertical: 12,
    borderRadius: 8,
    fontWeight: "700",
    overflow: "hidden"
  }
});

import { Link } from "expo-router";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function VenueHome() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Venue Area</Text>
        <Text style={styles.copy}>Manage menu, promos, and incoming orders.</Text>
        <Link href="/(venue)/dashboard" style={styles.link}>
          Open Dashboard
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  copy: { color: "#BDBDBD", fontSize: 16, lineHeight: 24 },
  link: {
    color: "#111111",
    backgroundColor: "#FFFFFF",
    textAlign: "center",
    paddingVertical: 12,
    borderRadius: 8,
    fontWeight: "600",
    overflow: "hidden"
  }
});

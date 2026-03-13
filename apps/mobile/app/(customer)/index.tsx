import { Link } from "expo-router";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function CustomerHome() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Customer Area</Text>
        <Link href="/(customer)/menu" style={styles.link}>
          View Menu
        </Link>
        <Link href="/(customer)/register" style={styles.link}>
          Join Mailing List
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", marginBottom: 8 },
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

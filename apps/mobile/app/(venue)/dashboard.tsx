import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function VenueDashboard() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Venue Dashboard</Text>
        <Text style={styles.copy}>Live orders, stock flags, and promotions go here.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  copy: { color: "#BDBDBD", fontSize: 16, lineHeight: 24 }
});

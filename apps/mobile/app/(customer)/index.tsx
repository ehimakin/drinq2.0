import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { VENUE, fetchActiveCustomerOrder } from "../../lib/drinq";
import { getActiveOrderId, getCustomerProfile, setActiveOrderId } from "../../lib/session";

export default function CustomerHome() {
  const router = useRouter();
  const [activeOrderId, setLocalActiveOrderId] = useState<number | null>(getActiveOrderId());

  useEffect(() => {
    let active = true;
    const customerProfile = getCustomerProfile();
    if (!customerProfile?.token) return;
    fetchActiveCustomerOrder(customerProfile.token)
      .then((activeOrder) => {
        if (!active) return;
        const nextId = Number(activeOrder?.order_id || 0) || null;
        setActiveOrderId(nextId);
        setLocalActiveOrderId(nextId);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.badge}>{VENUE.tag}</Text>
        <Text style={styles.title}>Customer Flow Prototype</Text>
        <Text style={styles.copy}>
          Customers are meant to use the web app first. This screen is kept only as a secondary mobile prototype and is not the primary ordering surface.
        </Text>
        <Link href="/(customer)/menu" style={styles.link}>
          Open Prototype Flow
        </Link>
        {activeOrderId ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() =>
              router.push({
                pathname: "/(customer)/order/[id]",
                params: { id: String(activeOrderId) }
              })
            }
          >
            <Text style={styles.primaryButtonText}>Resume Active Order #{activeOrderId}</Text>
          </Pressable>
        ) : null}
        <Link href="/(customer)/register" style={styles.link}>
          Join Mailing List
        </Link>
        <Text style={styles.footnote}>Primary customer journey lives in `apps/web`, not Expo.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 },
  badge: { color: "#F5B4C7", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  copy: { color: "#BDBDBD", fontSize: 15, lineHeight: 22, marginBottom: 4 },
  link: {
    color: "#111111",
    backgroundColor: "#FFFFFF",
    textAlign: "center",
    paddingVertical: 12,
    borderRadius: 8,
    fontWeight: "600",
    overflow: "hidden"
  },
  primaryButton: {
    backgroundColor: "#B31942",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center"
  },
  primaryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  footnote: { color: "#8F98A3", fontSize: 13, lineHeight: 20, marginTop: 8 }
});

import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

type OrderDetails = {
  order_id: number;
  customer_name: string;
  customer_email: string;
  delivery_mode: string;
  delivery_target: string;
  status: string;
  eta_text: string;
  items: Array<{ item_name: string; quantity: number; price_text: string }>;
};

const API_BASE = "http://localhost:8000";
const RUNNER_STATUS_OPTIONS = ["assigned", "loaded", "en_route", "arrived", "fulfilled", "cancelled"] as const;

export default function RunnerOrderScreen() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const orderId = Number(id);
  const authToken = token ?? "";
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOrder = async () => {
    if (!orderId || !authToken) return;
    try {
      const response = await fetch(`${API_BASE}/api/order-status/${orderId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setOrder(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [orderId, authToken]);

  const updateStatus = async (status: (typeof RUNNER_STATUS_OPTIONS)[number]) => {
    if (!orderId || !authToken) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/order-status/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ status })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await loadOrder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Runner Order #{orderId}</Text>
        {!authToken ? <Text style={styles.error}>Missing staff session token. Return to runner queue and login.</Text> : null}
        {error ? <Text style={styles.error}>Error: {error}</Text> : null}

        {!order ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>Loading order...</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Status: {order.status}</Text>
              <Text style={styles.cardText}>Customer: {order.customer_name}</Text>
              <Text style={styles.cardText}>Email: {order.customer_email}</Text>
              <Text style={styles.cardText}>
                {order.delivery_mode} - {order.delivery_target}
              </Text>
              <Text style={styles.cardText}>ETA: {order.eta_text}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Items</Text>
              {order.items.map((item, index) => (
                <Text key={`${item.item_name}-${index}`} style={styles.cardText}>
                  {item.item_name} x{item.quantity} ({item.price_text})
                </Text>
              ))}
            </View>

            <View style={styles.actions}>
              {RUNNER_STATUS_OPTIONS.map((status) => (
                <Pressable
                  key={status}
                  style={[styles.button, busy ? styles.buttonDisabled : null]}
                  disabled={busy}
                  onPress={() => updateStatus(status)}
                >
                  <Text style={styles.buttonText}>{status}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={[styles.button, styles.secondary]} disabled={busy || !authToken} onPress={loadOrder}>
              <Text style={styles.buttonText}>Refresh</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { padding: 16, gap: 10 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  error: { color: "#FF7A85", marginBottom: 8 },
  card: {
    backgroundColor: "#161A1F",
    borderColor: "#2E343B",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12
  },
  cardTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 4 },
  cardText: { color: "#BDBDBD", fontSize: 14, marginBottom: 2 },
  actions: { gap: 8 },
  button: {
    backgroundColor: "#FF3B30",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center"
  },
  secondary: { backgroundColor: "#2E343B" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontWeight: "700", textTransform: "capitalize" }
});

import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

type RunnerOrder = {
  order_id: number;
  customer_name: string;
  delivery_mode: string;
  delivery_target: string;
  status: string;
  eta_text: string;
};

const API_BASE = "http://localhost:8000";
const VENUE_SLUG = "brentford-fc";

export default function RunnerQueueScreen() {
  const [orders, setOrders] = useState<RunnerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("8888");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (staffToken: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/orders?venue_slug=${encodeURIComponent(VENUE_SLUG)}&limit=50`, {
        headers: { Authorization: `Bearer ${staffToken}` }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setOrders(data.orders ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const login = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/staff/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_slug: VENUE_SLUG,
          pin: pin.trim(),
          role: "runner"
        })
      });
      if (!response.ok) {
        throw new Error(`Auth failed (${response.status})`);
      }
      const data = await response.json();
      setToken(data.token);
      await load(data.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (token) {
      load(token);
    }
  }, [token]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Runner Queue</Text>
        <Text style={styles.subtitle}>Venue: {VENUE_SLUG}</Text>
        {!token ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Staff PIN Login</Text>
            <TextInput
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              keyboardType="number-pad"
              style={styles.input}
              placeholder="Enter runner PIN"
              placeholderTextColor="#8D96A0"
            />
            <Pressable style={[styles.button, busy ? styles.buttonDisabled : null]} disabled={busy} onPress={login}>
              <Text style={styles.buttonText}>Unlock Runner Queue</Text>
            </Pressable>
            <Text style={styles.cardText}>DEV default PIN: 8888</Text>
          </View>
        ) : (
          <Pressable style={styles.secondaryButton} onPress={() => load(token)}>
            <Text style={styles.buttonText}>Refresh Queue</Text>
          </Pressable>
        )}
        {error ? <Text style={styles.error}>Error loading orders: {error}</Text> : null}

        {!token ? null : orders.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>No live orders found.</Text>
          </View>
        ) : (
          orders.map((order) => (
            <Link
              key={order.order_id}
              href={{
                pathname: "/(runner)/order/[id]",
                params: { id: String(order.order_id), token: token ?? undefined }
              }}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>
                Order #{order.order_id} - {order.status}
              </Text>
              <Text style={styles.cardText}>Customer: {order.customer_name}</Text>
              <Text style={styles.cardText}>
                {order.delivery_mode} - {order.delivery_target}
              </Text>
              <Text style={styles.cardText}>ETA: {order.eta_text}</Text>
            </Link>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { padding: 16, gap: 10 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#BDBDBD", fontSize: 14, marginBottom: 6 },
  error: { color: "#FF7A85", marginBottom: 8 },
  card: {
    backgroundColor: "#161A1F",
    borderColor: "#2E343B",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12
  },
  input: {
    borderWidth: 1,
    borderColor: "#2E343B",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#FFFFFF",
    backgroundColor: "#11151A",
    marginTop: 8,
    marginBottom: 8
  },
  button: {
    backgroundColor: "#FF3B30",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 8
  },
  secondaryButton: {
    backgroundColor: "#2E343B",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 8
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  cardTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginBottom: 4 },
  cardText: { color: "#BDBDBD", fontSize: 14 }
});

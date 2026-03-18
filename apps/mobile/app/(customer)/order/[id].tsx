import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  describeCustomerOrderState,
  describePaymentStatus,
  fetchOrderStatus,
  formatPennies,
  isClickAndCollect,
  submitTip,
  type OrderStatusResponse
} from "../../../lib/drinq";
import { clearCart, setActiveOrderId, setPendingTipAmountPennies } from "../../../lib/session";

const TIP_OPTIONS = [100, 200, 300, 500];
const POLL_INTERVAL_MS = 5000;

function isActiveStatus(status: string) {
  return ["received", "accepted", "ready", "ready_for_collection", "assigned", "loaded", "en_route", "arrived"].includes(
    String(status || "").toLowerCase()
  );
}

export default function CustomerOrderStatusScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const orderId = Number(params.id || 0);
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [tipBusy, setTipBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!orderId) return;
      try {
        const nextOrder = await fetchOrderStatus(orderId);
        if (!active) return;
        setOrder(nextOrder);
        setError(null);
        setBusy(false);
        if (isActiveStatus(nextOrder.status)) {
          setActiveOrderId(nextOrder.order_id);
        } else {
          setActiveOrderId(null);
        }
      } catch (nextError) {
        if (!active) return;
        setError((nextError as Error).message);
        setBusy(false);
      }
    };

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderId]);

  const addTip = async (amount: number) => {
    if (!order || tipBusy) return;
    setTipBusy(true);
    try {
      await submitTip(order.order_id, amount);
      setPendingTipAmountPennies(amount);
      const refreshed = await fetchOrderStatus(order.order_id);
      setOrder(refreshed);
    } catch (nextError) {
      Alert.alert("Tip error", (nextError as Error).message);
    } finally {
      setTipBusy(false);
    }
  };

  if (busy) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.loadingCopy}>Loading live order status...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Order unavailable</Text>
          <Text style={styles.errorCopy}>{error ?? "This order could not be loaded."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = describeCustomerOrderState(order);
  const payment = describePaymentStatus(order.payment_status);
  const collectOrder = isClickAndCollect(order.delivery_mode);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroChip}>{status.chip}</Text>
          <Text style={styles.heroTitle}>Order #{order.order_id}</Text>
          <Text style={styles.heroCopy}>{status.copy}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live Status</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>ETA</Text>
            <Text style={styles.rowValue}>{order.eta_text}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Fulfilment</Text>
            <Text style={styles.rowValue}>{order.delivery_mode}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Target</Text>
            <Text style={styles.rowValue}>{order.delivery_target}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Payment</Text>
            <Text style={styles.rowValue}>{payment.label}</Text>
          </View>
          <Text style={styles.cardNote}>{payment.copy}</Text>
        </View>

        {collectOrder ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Collection</Text>
            <Text style={styles.pickupLabel}>Pickup Code</Text>
            <Text style={styles.pickupCode}>{order.pickup_code || "Pending"}</Text>
            <Text style={styles.cardNote}>When the order is ready, show this code at collection. Venue staff can then verify and close the order.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items</Text>
          {order.items.map((item) => (
            <View style={styles.row} key={item.item_id}>
              <Text style={styles.rowLabel}>
                {item.quantity} x {item.item_name}
              </Text>
              <Text style={styles.rowValue}>{item.price_text}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Tip</Text>
            <Text style={styles.rowValue}>{formatPennies(order.tip_amount_pennies)}</Text>
          </View>
        </View>

        {!order.has_tip && !["rejected", "cancelled", "failed", "uncollected"].includes(order.status.toLowerCase()) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add Tip</Text>
            <Text style={styles.cardNote}>The original MVP supported gratuity after checkout. This mobile flow now does the same against the current API.</Text>
            <View style={styles.tipRow}>
              {TIP_OPTIONS.map((amount) => (
                <Pressable
                  key={amount}
                  onPress={() => addTip(amount)}
                  disabled={tipBusy}
                  style={[styles.tipButton, tipBusy ? styles.tipButtonDisabled : null]}
                >
                  <Text style={styles.tipButtonText}>{formatPennies(amount)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {!isActiveStatus(order.status) ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              clearCart();
              setActiveOrderId(null);
              router.replace("/(customer)/menu");
            }}
          >
            <Text style={styles.primaryButtonText}>Start Another Order</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111A" },
  container: { padding: 20, gap: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingCopy: { color: "#B8C3CF", fontSize: 15 },
  errorTitle: { color: "#FFFFFF", fontSize: 26, fontWeight: "800" },
  errorCopy: { color: "#B8C3CF", fontSize: 15, textAlign: "center" },
  hero: {
    backgroundColor: "#B31942",
    borderRadius: 24,
    padding: 20,
    gap: 10
  },
  heroChip: { color: "#FCE3EA", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  heroTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "800" },
  heroCopy: { color: "#FFF0F4", fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: "#101C27",
    borderWidth: 1,
    borderColor: "#233444",
    borderRadius: 18,
    padding: 16,
    gap: 12
  },
  cardTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { color: "#C5D0DB", fontSize: 14, flex: 1 },
  rowValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  cardNote: { color: "#9EADB9", fontSize: 13, lineHeight: 19 },
  pickupLabel: { color: "#A8B7C4", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2 },
  pickupCode: { color: "#FFFFFF", fontSize: 34, fontWeight: "900", letterSpacing: 4 },
  tipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tipButton: {
    borderRadius: 999,
    backgroundColor: "#0A141D",
    borderWidth: 1,
    borderColor: "#2A3B4B",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  tipButtonDisabled: { opacity: 0.5 },
  tipButtonText: { color: "#FFFFFF", fontWeight: "700" },
  primaryButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonText: { color: "#07111A", fontSize: 16, fontWeight: "800" }
});

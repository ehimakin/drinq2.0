import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import {
  VENUE,
  createOrder,
  deliveryFeePennies,
  fetchActiveCustomerOrder,
  formatPennies,
  saveCustomerProfile,
  totalPennies
} from "../../lib/drinq";
import {
  clearCart,
  getCart,
  getCustomerProfile,
  getPendingTipAmountPennies,
  getSelectedDeliveryMode,
  setActiveOrderId,
  setCustomerProfile,
  setPendingTipAmountPennies
} from "../../lib/session";

const TIP_OPTIONS = [0, 100, 200, 300, 500];

export default function CustomerCheckoutScreen() {
  const router = useRouter();
  const cart = getCart();
  const savedProfile = getCustomerProfile();
  const deliveryMode = getSelectedDeliveryMode();
  const [name, setName] = useState(savedProfile?.name ?? "");
  const [email, setEmail] = useState(savedProfile?.email ?? "");
  const [deliveryTarget, setDeliveryTarget] = useState(savedProfile?.deliveryTarget ?? "");
  const [rememberMe, setRememberMe] = useState(savedProfile?.checkoutType !== "guest");
  const [tipAmountPennies, setTipAmountPennies] = useState(getPendingTipAmountPennies());
  const [busy, setBusy] = useState(false);

  const deliveryFee = useMemo(() => deliveryFeePennies(deliveryMode), [deliveryMode]);
  const orderTotal = useMemo(() => totalPennies(cart, deliveryMode, tipAmountPennies), [cart, deliveryMode, tipAmountPennies]);

  const canSubmit = cart.length > 0 && name.trim() && email.trim() && deliveryTarget.trim();

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      let customerToken = savedProfile?.token ?? null;
      if (rememberMe) {
        const profile = await saveCustomerProfile({
          name: name.trim(),
          email: email.trim(),
          deliveryMode,
          deliveryTarget: deliveryTarget.trim()
        });
        customerToken = String(profile.customer_token || "");
        setCustomerProfile({
          customerId: Number(profile.customer_id || 0) || null,
          token: customerToken,
          name: String(profile.name || name.trim()),
          email: String(profile.email || email.trim()),
          deliveryMode: String(profile.delivery_mode || deliveryMode),
          deliveryTarget: String(profile.delivery_target || deliveryTarget.trim()),
          checkoutType: "remembered"
        });

        const activeOrder = customerToken ? await fetchActiveCustomerOrder(customerToken) : null;
        if (activeOrder?.order_id) {
          setActiveOrderId(activeOrder.order_id);
          router.replace({
            pathname: "/(customer)/order/[id]",
            params: { id: String(activeOrder.order_id) }
          });
          return;
        }
      }

      const response = await createOrder({
        customerName: name.trim(),
        customerEmail: email.trim(),
        deliveryMode,
        deliveryTarget: deliveryTarget.trim(),
        items: cart,
        checkoutType: rememberMe ? "remembered" : "guest",
        customerToken,
        tipAmountPennies
      });

      if (response.customer_profile) {
        setCustomerProfile({
          customerId: Number(response.customer_profile.customer_id || 0) || null,
          token: String(response.customer_profile.customer_token || customerToken || ""),
          name: String(response.customer_profile.name || name.trim()),
          email: String(response.customer_profile.email || email.trim()),
          deliveryMode: String(response.customer_profile.delivery_mode || deliveryMode),
          deliveryTarget: String(response.customer_profile.delivery_target || deliveryTarget.trim()),
          checkoutType: "remembered"
        });
      }

      setPendingTipAmountPennies(tipAmountPennies);
      setActiveOrderId(Number(response.order_id));
      clearCart();
      router.replace({
        pathname: "/(customer)/order/[id]",
        params: { id: String(response.order_id) }
      });
    } catch (error) {
      Alert.alert("Checkout error", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>{VENUE.tag}</Text>
        <Text style={styles.title}>Checkout</Text>
        <Text style={styles.subtitle}>Complete the order with the same journey your MVP centered around: customer, payment state, and active-order recovery.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order Summary</Text>
          {cart.map((item) => (
            <View style={styles.row} key={item.item_id}>
              <Text style={styles.rowLabel}>
                {item.quantity} x {item.item_name}
              </Text>
              <Text style={styles.rowValue}>{formatPennies(item.quantity * Number(item.price_text.replace(/[^0-9.]/g, "")) * 100)}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Fulfilment</Text>
            <Text style={styles.rowValue}>{deliveryMode}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Delivery fee</Text>
            <Text style={styles.rowValue}>{formatPennies(deliveryFee)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Tip</Text>
            <Text style={styles.rowValue}>{formatPennies(tipAmountPennies)}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatPennies(orderTotal)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer Details</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor="#7C8793"
            style={styles.input}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#7C8793"
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={deliveryTarget}
            onChangeText={setDeliveryTarget}
            placeholder={deliveryMode === "Seat Delivery" ? "Block / Row / Seat" : deliveryMode === "Nearest Point" ? "Nearest point reference" : "Collection name or note"}
            placeholderTextColor="#7C8793"
            style={styles.input}
          />
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>Remember me on this device</Text>
              <Text style={styles.switchBody}>Uses the API-backed remembered customer profile and active-order recovery.</Text>
            </View>
            <Switch value={rememberMe} onValueChange={setRememberMe} trackColor={{ true: "#d5436d", false: "#25303a" }} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tip</Text>
          <View style={styles.tipRow}>
            {TIP_OPTIONS.map((amount) => (
              <Pressable
                key={amount}
                onPress={() => setTipAmountPennies(amount)}
                style={[styles.tipButton, tipAmountPennies === amount ? styles.tipButtonActive : null]}
              >
                <Text style={[styles.tipButtonText, tipAmountPennies === amount ? styles.tipButtonTextActive : null]}>
                  {amount === 0 ? "No tip" : formatPennies(amount)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={[styles.primaryButton, !canSubmit || busy ? styles.buttonDisabled : null]} disabled={!canSubmit || busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Place Order</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111A" },
  container: { padding: 20, gap: 16 },
  eyebrow: { color: "#F5B4C7", letterSpacing: 2, fontSize: 12, fontWeight: "700" },
  title: { color: "#FFFFFF", fontSize: 30, fontWeight: "800" },
  subtitle: { color: "#B8C3CF", fontSize: 15, lineHeight: 22 },
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
  rowValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  totalRow: { borderTopWidth: 1, borderTopColor: "#233444", paddingTop: 12, marginTop: 4 },
  totalLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  totalValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A3B4B",
    backgroundColor: "#0B141C",
    color: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  switchRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" },
  switchCopy: { flex: 1, gap: 4 },
  switchTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  switchBody: { color: "#9EADB9", fontSize: 13, lineHeight: 18 },
  tipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tipButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2A3B4B",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#0A141D"
  },
  tipButtonActive: { backgroundColor: "#B31942", borderColor: "#B31942" },
  tipButtonText: { color: "#D3DCE4", fontWeight: "600" },
  tipButtonTextActive: { color: "#FFFFFF" },
  primaryButton: {
    backgroundColor: "#B31942",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center"
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  buttonDisabled: { opacity: 0.45 }
});

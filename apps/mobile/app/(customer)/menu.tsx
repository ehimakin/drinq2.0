import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { VENUE, cartSubtotalPennies, formatPennies, type CartLine } from "../../lib/drinq";
import {
  getActiveOrderId,
  getCart,
  getSelectedDeliveryMode,
  setCart,
  setSelectedDeliveryMode
} from "../../lib/session";

export default function CustomerMenu() {
  const router = useRouter();
  const [deliveryMode, setDeliveryMode] = useState(getSelectedDeliveryMode());
  const [cart, setCartState] = useState<CartLine[]>(getCart());
  const activeOrderId = getActiveOrderId();

  const subtotal = useMemo(() => cartSubtotalPennies(cart), [cart]);

  const updateQuantity = (itemId: string, itemName: string, priceText: string, delta: number) => {
    const nextCart = [...cart];
    const existingIndex = nextCart.findIndex((entry) => entry.item_id === itemId);
    if (existingIndex === -1 && delta > 0) {
      nextCart.push({
        item_id: itemId,
        item_name: itemName,
        price_text: priceText,
        quantity: 1
      });
    } else if (existingIndex >= 0) {
      const nextQuantity = nextCart[existingIndex].quantity + delta;
      if (nextQuantity <= 0) {
        nextCart.splice(existingIndex, 1);
      } else {
        nextCart[existingIndex] = { ...nextCart[existingIndex], quantity: nextQuantity };
      }
    }
    setCart(nextCart);
    setCartState(nextCart);
  };

  const quantityFor = (itemId: string) => cart.find((entry) => entry.item_id === itemId)?.quantity ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.badge}>{VENUE.tag}</Text>
        <Text style={styles.title}>{VENUE.name}</Text>
        <Text style={styles.copy}>{VENUE.subtitle}</Text>

        {activeOrderId ? (
          <Pressable
            style={styles.resumeCard}
            onPress={() =>
              router.push({
                pathname: "/(customer)/order/[id]",
                params: { id: String(activeOrderId) }
              })
            }
          >
            <Text style={styles.resumeTitle}>Active order in progress</Text>
            <Text style={styles.resumeCopy}>Resume order #{activeOrderId} instead of starting a second live order.</Text>
          </Pressable>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Choose fulfilment</Text>
          {VENUE.fulfillmentModes.map((mode) => (
            <Pressable
              key={mode.label}
              onPress={() => {
                setSelectedDeliveryMode(mode.label);
                setDeliveryMode(mode.label);
              }}
              style={[styles.modeButton, deliveryMode === mode.label ? styles.modeButtonActive : null]}
            >
              <View style={styles.modeCopy}>
                <Text style={[styles.modeTitle, deliveryMode === mode.label ? styles.modeTitleActive : null]}>{mode.label}</Text>
                <Text style={styles.modeDetail}>
                  {mode.eta} • {mode.fee} • {mode.detail}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Menu</Text>
          {VENUE.menuItems
            .filter((item) => item.options.includes(deliveryMode))
            .map((item) => (
              <View style={styles.itemCard} key={item.id}>
                <View style={styles.itemHeader}>
                  <View style={styles.itemCopy}>
                    <Text style={styles.itemCategory}>{item.category}</Text>
                    <Text style={styles.itemTitle}>{item.name}</Text>
                    <Text style={styles.itemPrice}>{item.price}</Text>
                  </View>
                  <View style={styles.qtyControl}>
                    <Pressable style={styles.qtyButton} onPress={() => updateQuantity(item.id, item.name, item.price, -1)}>
                      <Text style={styles.qtyButtonText}>-</Text>
                    </Pressable>
                    <Text style={styles.qtyValue}>{quantityFor(item.id)}</Text>
                    <Pressable style={styles.qtyButton} onPress={() => updateQuantity(item.id, item.name, item.price, 1)}>
                      <Text style={styles.qtyButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
        </View>

        <View style={styles.checkoutBar}>
          <View>
            <Text style={styles.checkoutLabel}>Subtotal</Text>
            <Text style={styles.checkoutTotal}>{formatPennies(subtotal)}</Text>
          </View>
          <Pressable
            style={[styles.checkoutButton, cart.length === 0 && !activeOrderId ? styles.checkoutButtonDisabled : null]}
            disabled={cart.length === 0 && !activeOrderId}
            onPress={() =>
              activeOrderId
                ? router.push({
                    pathname: "/(customer)/order/[id]",
                    params: { id: String(activeOrderId) }
                  })
                : router.push("/(customer)/checkout")
            }
          >
            <Text style={styles.checkoutButtonText}>{activeOrderId ? "Resume Order" : "Checkout"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07111A" },
  container: { padding: 20, gap: 16 },
  badge: { color: "#F5B4C7", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#FFFFFF", fontSize: 30, fontWeight: "800" },
  copy: { color: "#B8C3CF", fontSize: 15, lineHeight: 22 },
  resumeCard: {
    backgroundColor: "#B31942",
    borderRadius: 18,
    padding: 16,
    gap: 6
  },
  resumeTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  resumeCopy: { color: "#F8DDE5", fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: "#101C27",
    borderWidth: 1,
    borderColor: "#233444",
    borderRadius: 18,
    padding: 16,
    gap: 12
  },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  modeButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A3B4B",
    backgroundColor: "#0A141D",
    padding: 14
  },
  modeButtonActive: {
    backgroundColor: "#163044",
    borderColor: "#4B86A8"
  },
  modeCopy: { gap: 4 },
  modeTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  modeTitleActive: { color: "#D9F0FF" },
  modeDetail: { color: "#9FB0BE", fontSize: 13, lineHeight: 18 },
  itemCard: {
    borderRadius: 14,
    backgroundColor: "#0A141D",
    borderWidth: 1,
    borderColor: "#223242",
    padding: 14
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" },
  itemCopy: { flex: 1, gap: 4 },
  itemCategory: { color: "#97A9B8", fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2 },
  itemTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  itemPrice: { color: "#DCE6EE", fontSize: 15 },
  qtyControl: { flexDirection: "row", alignItems: "center", gap: 10 },
  qtyButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#162330"
  },
  qtyButtonText: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  qtyValue: { color: "#FFFFFF", minWidth: 20, textAlign: "center", fontWeight: "700" },
  checkoutBar: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  checkoutLabel: { color: "#516272", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 },
  checkoutTotal: { color: "#07111A", fontSize: 26, fontWeight: "800" },
  checkoutButton: {
    backgroundColor: "#07111A",
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  checkoutButtonDisabled: { opacity: 0.4 },
  checkoutButtonText: { color: "#FFFFFF", fontWeight: "800" }
});

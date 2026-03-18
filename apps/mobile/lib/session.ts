import type { CartLine, CustomerProfile } from "./drinq";

type SessionState = {
  cart: CartLine[];
  customerProfile: CustomerProfile | null;
  activeOrderId: number | null;
  selectedDeliveryMode: string;
  pendingTipAmountPennies: number;
};

const state: SessionState = {
  cart: [],
  customerProfile: null,
  activeOrderId: null,
  selectedDeliveryMode: "Seat Delivery",
  pendingTipAmountPennies: 200
};

export function getCart() {
  return state.cart;
}

export function setCart(cart: CartLine[]) {
  state.cart = cart;
}

export function clearCart() {
  state.cart = [];
}

export function getCustomerProfile() {
  return state.customerProfile;
}

export function setCustomerProfile(profile: CustomerProfile | null) {
  state.customerProfile = profile;
}

export function getActiveOrderId() {
  return state.activeOrderId;
}

export function setActiveOrderId(orderId: number | null) {
  state.activeOrderId = orderId;
}

export function getSelectedDeliveryMode() {
  return state.selectedDeliveryMode;
}

export function setSelectedDeliveryMode(deliveryMode: string) {
  state.selectedDeliveryMode = deliveryMode;
}

export function getPendingTipAmountPennies() {
  return state.pendingTipAmountPennies;
}

export function setPendingTipAmountPennies(amount: number) {
  state.pendingTipAmountPennies = Math.max(0, amount);
}

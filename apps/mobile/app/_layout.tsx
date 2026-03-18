import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#111111" },
        headerTintColor: "#ffffff",
        contentStyle: { backgroundColor: "#0A0A0A" }
      }}
    />
  );
}

import { Stack } from "expo-router";

export default function RunnerLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Runner Queue" }} />
      <Stack.Screen name="order/[id]" options={{ title: "Runner Order" }} />
    </Stack>
  );
}

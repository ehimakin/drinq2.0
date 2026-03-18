import { Stack } from "expo-router";

export default function VenueLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Venue" }} />
      <Stack.Screen name="dashboard" options={{ title: "Venue Dashboard" }} />
    </Stack>
  );
}

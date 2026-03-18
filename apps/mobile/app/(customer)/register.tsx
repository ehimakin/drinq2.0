import { useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { joinMailingList } from "../../lib/drinq";

export default function CustomerRegister() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || busy) return;
    setBusy(true);
    try {
      await joinMailingList({ name: name.trim(), email: email.trim() });
      setName("");
      setEmail("");
      Alert.alert("Registered", "You have been added to the mailing list for this venue.");
    } catch (error) {
      Alert.alert("Registration error", (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Join The List</Text>
        <TextInput
          placeholder="Name"
          placeholderTextColor="#888888"
          style={styles.input}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          placeholder="Email"
          placeholderTextColor="#888888"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Pressable style={[styles.button, busy ? styles.buttonDisabled : null]} disabled={busy} onPress={submit}>
          <Text style={styles.buttonText}>{busy ? "Submitting..." : "Register"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0A0A0A" },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 10 },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#303030",
    backgroundColor: "#151515",
    color: "#FFFFFF",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  button: {
    marginTop: 4,
    backgroundColor: "#FF3B30",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center"
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontWeight: "700" }
});

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import MapView, { Marker, Circle, Region } from "react-native-maps";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

type Player = {
  id: string;
  name: string;
  role: "HUNTER" | "HIDER";
  latitude?: number;
  longitude?: number;
  sharing: boolean;
  updatedAt: number;
};

const makeId = () => Math.random().toString(36).slice(2, 10);
const makeRoom = () => Math.floor(100000 + Math.random() * 900000).toString();

// Round coordinates to roughly 100m cells before they leave this phone.
// HUNTER never broadcasts a player's exact GPS coordinates.
function blurCoordinate(value: number) {
  return Math.round(value * 100) / 1000;
}

export default function App() {
  const [name, setName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [role, setRole] = useState<"HUNTER" | "HIDER">("HIDER");
  const [players, setPlayers] = useState<Player[]>([]);
  const [sharing, setSharing] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Create a room or join with a code.");
  const [region, setRegion] = useState<Region>({
    latitude: 37.0902, longitude: -95.7129,
    latitudeDelta: 0.08, longitudeDelta: 0.08
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const idRef = useRef(makeId());
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const latestLocation = useRef<Location.LocationObject | null>(null);

  useEffect(() => () => {
    locationSub.current?.remove();
    if (channelRef.current) supabase?.removeChannel(channelRef.current);
  }, []);

  const publishPresence = async (coords?: { latitude: number; longitude: number }) => {
    const channel = channelRef.current;
    if (!channel) return;
    const player: Player = {
      id: idRef.current,
      name: name.trim() || "Player",
      role,
      sharing: Boolean(coords),
      updatedAt: Date.now(),
      ...(coords || {})
    };
    await channel.track(player);
  };

  const connectRoom = async (code: string, isHost: boolean) => {
    if (!supabase) {
      Alert.alert("Setup needed", "Add your Supabase project URL and anon key to the .env file first. See README.md.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Your player name", "Enter a nickname before joining.");
      return;
    }
    setBusy(true);
    try {
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
      const nextRole = isHost ? "HUNTER" : "HIDER";
      setRole(nextRole);
      const channel = supabase.channel("hunter:" + code, {
        config: { presence: { key: idRef.current }, broadcast: { self: false } }
      });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Player>();
        const all = Object.values(state).flat().filter(p => p.id !== idRef.current);
        setPlayers(all);
      });
      channel.on("broadcast", { event: "game" }, ({ payload }) => {
        if (payload?.started !== undefined) setGameStarted(Boolean(payload.started));
      });
      await new Promise<void>((resolve, reject) => {
        channel.subscribe(status => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Could not connect. Check your Supabase setup and internet."));
        });
      });
      channelRef.current = channel;
      setRoomCode(code);
      setRole(nextRole);
      setGameStarted(false);
      setSharing(false);
      await channel.track({
        id: idRef.current, name: name.trim(), role: nextRole,
        sharing: false, updatedAt: Date.now()
      });
      setMessage(isHost ? "Room created. Share the code with your players." : "Joined! Wait for the Hunter to start.");
    } catch (e: any) {
      Alert.alert("Couldn't join", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSharing = async () => {
    if (!channelRef.current) return;
    if (sharing) {
      locationSub.current?.remove();
      locationSub.current = null;
      setSharing(false);
      await publishPresence();
      setMessage("Location sharing is OFF.");
      return;
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Location permission", "Allow location while using the app, then choose Share location again.");
      return;
    }
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      latestLocation.current = current;
      setRegion({
        latitude: current.coords.latitude, longitude: current.coords.longitude,
        latitudeDelta: 0.025, longitudeDelta: 0.025
      });
      const coarse = {
        latitude: blurCoordinate(current.coords.latitude),
        longitude: blurCoordinate(current.coords.longitude)
      };
      await publishPresence(coarse);
      setSharing(true);
      setMessage("Sharing an approximate location with this room only.");
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 15 },
        async loc => {
          latestLocation.current = loc;
          const blurred = {
            latitude: blurCoordinate(loc.coords.latitude),
            longitude: blurCoordinate(loc.coords.longitude)
          };
          await publishPresence(blurred);
          setRegion(prev => ({ ...prev, latitude: loc.coords.latitude, longitude: loc.coords.longitude }));
        }
      );
    } catch {
      Alert.alert("Location unavailable", "HUNTER couldn't get your location. Check your device settings.");
    }
  };

  const startGame = async () => {
    if (role !== "HUNTER" || !channelRef.current) return;
    setGameStarted(true);
    await channelRef.current.send({ type: "broadcast", event: "game", payload: { started: true } });
    setMessage("Game is LIVE. Stay inside your agreed play area.");
  };

  const endGame = async () => {
    locationSub.current?.remove();
    locationSub.current = null;
    setSharing(false);
    setGameStarted(false);
    await publishPresence();
    await channelRef.current?.send({ type: "broadcast", event: "game", payload: { started: false } });
    setMessage("Game ended. Location sharing is OFF.");
  };

  const leaveRoom = async () => {
    locationSub.current?.remove();
    locationSub.current = null;
    setSharing(false);
    setGameStarted(false);
    if (channelRef.current && supabase) await supabase.removeChannel(channelRef.current);
    channelRef.current = null;
    setPlayers([]);
    setRoomCode("");
    setMessage("You left the room. Location sharing is OFF.");
  };

  const shownPlayers = players.filter(p => p.sharing && typeof p.latitude === "number" && typeof p.longitude === "number");
  const myLocation = latestLocation.current;
  const mapCenter = myLocation
    ? { latitude: myLocation.coords.latitude, longitude: myLocation.coords.longitude }
    : { latitude: region.latitude, longitude: region.longitude };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View>
              <Text style={styles.brand}>HUNTER</Text>
              <Text style={styles.tagline}>REAL-WORLD HIDE & SEEK</Text>
            </View>
            <View style={[styles.liveDot, gameStarted && styles.liveDotOn]} />
          </View>

          {!roomCode ? (
            <View style={styles.panel}>
              <Text style={styles.heading}>Join the game</Text>
              <Text style={styles.label}>YOUR NICKNAME</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Enter a nickname" placeholderTextColor="#77808e" maxLength={18} style={styles.input} />
              <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => connectRoom(makeRoom(), true)}>
                {busy ? <ActivityIndicator color="#07110e" /> : <Text style={styles.primaryText}>CREATE ROOM · BE HUNTER</Text>}
              </TouchableOpacity>
              <View style={styles.separator}><View style={styles.line} /><Text style={styles.muted}>OR JOIN A ROOM</Text><View style={styles.line} /></View>
              <TextInput value={roomInput} onChangeText={setRoomInput} placeholder="6-digit room code" placeholderTextColor="#77808e" keyboardType="number-pad" maxLength={6} style={styles.input} />
              <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => connectRoom(roomInput.trim(), false)}>
                <Text style={styles.secondaryText}>JOIN AS HIDER</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.roomBar}>
                <View><Text style={styles.label}>ROOM CODE</Text><Text style={styles.roomCode}>{roomCode}</Text></View>
                <View style={styles.rolePill}><Text style={styles.roleText}>{role}</Text></View>
              </View>
              <View style={styles.mapWrap}>
                <MapView style={styles.map} region={region} onRegionChangeComplete={setRegion}>
                  {sharing && myLocation && <Marker coordinate={{ latitude: blurCoordinate(myLocation.coords.latitude), longitude: blurCoordinate(myLocation.coords.longitude) }} title="You" pinColor="#b8ff65" />}
                  {shownPlayers.map(p => <Marker key={p.id} coordinate={{ latitude: p.latitude!, longitude: p.longitude! }} title={p.name} description={p.role} pinColor={p.role === "HUNTER" ? "#ff5c68" : "#b8ff65"} />)}
                  {sharing && myLocation && <Circle center={mapCenter} radius={100} fillColor="rgba(184,255,101,0.08)" strokeColor="rgba(184,255,101,0.35)" />}
                </MapView>
                <View style={styles.mapTag}><View style={[styles.liveDot, gameStarted && styles.liveDotOn]} /><Text style={styles.mapTagText}>{gameStarted ? "LIVE GAME" : "LOBBY"}</Text></View>
              </View>
              <View style={styles.panel}>
                <Text style={styles.heading}>Players · {players.length + 1}</Text>
                <Text style={styles.muted}>Your location is shared only when you turn it on.</Text>
                <TouchableOpacity style={sharing ? styles.stopButton : styles.primary} onPress={toggleSharing}>
                  <Text style={sharing ? styles.stopText : styles.primaryText}>{sharing ? "STOP SHARING LOCATION" : "SHARE APPROXIMATE LOCATION"}</Text>
                </TouchableOpacity>
                {role === "HUNTER" && !gameStarted && <TouchableOpacity style={styles.secondary} onPress={startGame}><Text style={styles.secondaryText}>START GAME</Text></TouchableOpacity>}
                {gameStarted && <TouchableOpacity style={styles.secondary} onPress={endGame}><Text style={styles.secondaryText}>END GAME</Text></TouchableOpacity>}
                <View style={styles.playerList}>
                  <Text style={styles.playerName}>YOU · {name || "Player"} <Text style={styles.muted}>({role})</Text></Text>
                  {players.map(p => <View key={p.id} style={styles.playerRow}><Text style={styles.playerName}>{p.name} <Text style={styles.muted}>({p.role})</Text></Text><Text style={styles.muted}>{p.sharing ? "LOCATION ON" : "NOT SHARING"}</Text></View>)}
                </View>
                <Text style={styles.status}>{message}</Text>
                <TouchableOpacity style={styles.leave} onPress={leaveRoom}><Text style={styles.leaveText}>LEAVE ROOM</Text></TouchableOpacity>
              </View>
            </>
          )}
          <Text style={styles.safety}>PLAY SAFE: use a public, agreed play area in daylight. Walk; don't chase, enter roads or private property, or meet strangers. Location sharing is optional and stops when you leave.</Text>
          <Text style={styles.footer}>HUNTER · PLAY FAIR · STAY SAFE</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080c10" },
  container: { padding: 20, paddingBottom: 36 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 26, marginTop: 12 },
  brand: { color: "#b8ff65", fontSize: 34, fontWeight: "900", letterSpacing: 5 },
  tagline: { color: "#7d8793", fontSize: 10, letterSpacing: 2, marginTop: 3 },
  liveDot: { width: 12, height: 12, borderRadius: 8, backgroundColor: "#515965" },
  liveDotOn: { backgroundColor: "#b8ff65" },
  panel: { backgroundColor: "#111820", borderColor: "#25313c", borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 },
  heading: { color: "#f4f7fa", fontSize: 21, fontWeight: "800", marginBottom: 18 },
  label: { color: "#8d98a5", fontSize: 10, fontWeight: "800", letterSpacing: 1.8, marginBottom: 7 },
  input: { backgroundColor: "#080e14", borderWidth: 1, borderColor: "#2a3743", borderRadius: 11, padding: 15, color: "#fff", fontSize: 16, marginBottom: 14 },
  primary: { backgroundColor: "#b8ff65", borderRadius: 11, padding: 16, alignItems: "center", marginTop: 5 },
  primaryText: { color: "#10170b", fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  secondary: { borderColor: "#b8ff65", borderWidth: 1, borderRadius: 11, padding: 15, alignItems: "center", marginTop: 12 },
  secondaryText: { color: "#b8ff65", fontWeight: "900", letterSpacing: 1, fontSize: 12 },
  separator: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 20 },
  line: { height: 1, backgroundColor: "#2a3743", flex: 1 },
  muted: { color: "#84909c", fontSize: 11 },
  roomBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#111820", borderRadius: 14, padding: 16, marginBottom: 14 },
  roomCode: { color: "#b8ff65", fontSize: 27, fontWeight: "900", letterSpacing: 4 },
  rolePill: { borderWidth: 1, borderColor: "#b8ff65", borderRadius: 20, paddingHorizontal: 13, paddingVertical: 8 },
  roleText: { color: "#b8ff65", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  mapWrap: { height: 310, borderRadius: 18, overflow: "hidden", marginBottom: 14, borderWidth: 1, borderColor: "#293541" },
  map: { flex: 1 },
  mapTag: { position: "absolute", top: 12, left: 12, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#080c10dd", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20 },
  mapTagText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  stopButton: { backgroundColor: "#351d22", borderRadius: 11, padding: 15, alignItems: "center", marginTop: 14 },
  stopText: { color: "#ff929a", fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  playerList: { borderTopWidth: 1, borderTopColor: "#2a3743", marginTop: 18, paddingTop: 12 },
  playerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#202a34" },
  playerName: { color: "#f2f5f7", fontSize: 13, fontWeight: "700" },
  status: { color: "#b8ff65", fontSize: 12, marginTop: 14 },
  leave: { alignItems: "center", padding: 12, marginTop: 8 },
  leaveText: { color: "#ff7b84", fontWeight: "800", letterSpacing: 1, fontSize: 11 },
  safety: { color: "#7f8a96", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 10, paddingHorizontal: 4 },
  footer: { color: "#4e5965", textAlign: "center", fontSize: 9, letterSpacing: 2, marginTop: 20 }
});
# HUNTER

A live multiplayer, location-based hide-and-seek game for Android and iPhone, built with Expo React Native and Supabase Realtime.

## Current prototype

- Create a six-digit room as the Hunter, or join as a Hider.
- Players in the same room appear in the live room list.
- Location sharing is opt-in and foreground-only.
- Coordinates are rounded on-device to roughly 100-metre cells before being shared.
- The Hunter can start and end the game.
- Leaving the room stops location updates.

This is an early playable foundation. It does not yet include a catch/escape scoring system, safe-zone boundary enforcement, or production abuse controls.

## 1. Create a Supabase project

1. Create a project at https://supabase.com.
2. Open **Project Settings → API**.
3. Copy the Project URL and the anon/public key.
4. In the project dashboard, open **SQL Editor** and run:

```sql
create policy "HUNTER room realtime access"
on realtime.messages
for all
to anon
using (split_part(realtime.topic(), ':', 1) = 'hunter')
with check (split_part(realtime.topic(), ':', 1) = 'hunter');
```

Realtime room messages contain only player nicknames, role, and intentionally approximate coordinates. Do not put secrets or private profile details in room messages. For a public launch, add room-code rate limits, moderation/reporting, and stronger access controls.

## 2. Configure the app

Install Node.js LTS, then in this folder:

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Supabase URL and anon key:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

For Android map tiles, create a Google Maps Android API key with Maps SDK for Android enabled, then set `GOOGLE_MAPS_API_KEY` in your local build environment. Never commit private service-role keys.

## 3. Run the app

```bash
npx expo start
```

## 4. Build an APK

Install EAS CLI and sign in:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Then build an installable Android APK:

```bash
eas build --platform android --profile preview
```

## 5. Build an iPhone IPA

An iOS build requires Apple signing credentials. An installable device build generally requires an Apple Developer account:

```bash
eas build --platform ios --profile production
```

EAS provides the resulting IPA/build link when the cloud build completes. This repository contains the source and build configuration; it does not contain signed APK/IPA files yet.

## Safety and privacy

- Only share location after choosing **Share approximate location**.
- Sharing is limited to the active room and while the app is open.
- Location is rounded on the phone before broadcasting; other players do not receive raw GPS coordinates.
- Use a public, agreed play area in daylight. Walk, do not chase, and never enter roads, private property, or isolated places.
- Only play with people you know. Leave the room or stop sharing at any time.
- This prototype is not intended for emergency use or unattended tracking.

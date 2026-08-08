# Maestro mobile e2e

End-to-end smoke test for the Soma Expo / React Native app, driven by
[Maestro](https://maestro.dev). `smoke.yaml` launches the app and walks every
primary screen (Nutrition, Overview, Training, Running, Workouts, Sleep, Sync
Hub, More), asserting a stable header on each. It is a fast "does the app boot
and render every screen" check, not a data-correctness test, so it asserts only
static labels and never dynamic numbers, dates, or API-loaded values.

## What it covers

Navigation uses deep links (scheme `universal`, declared in `app.json`) because
Running / Workouts / Sleep / Connections live behind the "More" tab and are not
reachable by a direct tab-bar tap. The final step taps the "Food" tab-bar button
so the primary bottom navigation is exercised too.

| Screen | Route | Asserted text |
| --- | --- | --- |
| Nutrition (default) | `universal://nutrition` | `Trend`, `Day` |
| Overview | `universal://overview` | `Overview`, `Today at a glance` |
| Training | `universal://training` | `Training`, `Training load (PMC)` |
| Running | `universal://running` | `Running` |
| Workouts | `universal://workouts` | `Workouts`, `Training history and Garmin sync` |
| Sleep | `universal://sleep` | `Sleep & Recovery` |
| Sync Hub | `universal://connections` | `Sync Hub`, `Platforms` |
| More | `universal://more` | `More`, `Everything beyond the main tabs` |

App id: `dev.gkos.soma` (both iOS bundle id and Android package).

## Prerequisites

1. **Maestro CLI.** Install with:

   ```bash
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   ```

   Then restart the shell (or add `~/.maestro/bin` to `PATH`) and confirm with
   `maestro --version`.

2. **A running emulator or simulator** with the app installed:
   - Android emulator (`emulator -avd <name>`) or a connected device, or
   - iOS simulator (`xcrun simctl boot <udid>` / open it from Xcode).

3. **The Soma app installed on that device.** Build and install a dev/debug
   build from the `universal/` directory:

   ```bash
   cd universal
   npm run android     # or: npm run ios
   ```

   This installs the `dev.gkos.soma` build and starts Metro. Leave Metro running
   while the flow runs.

4. **A reachable backend (optional).** The app reads its API base from
   `EXPO_PUBLIC_API_URL` (default `http://localhost:3456`) and an optional
   `EXPO_PUBLIC_API_TOKEN`. The smoke flow asserts only static screen headers,
   which render even when the API is unreachable (the screens show an error card
   but keep their header), so the test passes without a live backend. Point
   `EXPO_PUBLIC_API_URL` at a running soma instance if you want the screens to
   populate with real data.

## Running

From the `universal/` directory:

```bash
maestro test .maestro/smoke.yaml
```

Or run the whole `.maestro/` directory (equivalent, and what the npm script
below does):

```bash
maestro test .maestro
```

There is also a package.json script:

```bash
npm run e2e:mobile
```

If more than one device is connected, target one explicitly:

```bash
maestro --device <emulator-id> test .maestro/smoke.yaml
```

Interactive debugging (inspect the view hierarchy and try commands live):

```bash
maestro studio
```

## CI

CI wiring is out of scope for this change: running Maestro in CI needs an
emulator runner (for example an Android AVD on a Linux runner via KVM, or a
macOS runner with an iOS simulator) plus a built and installed app artifact.
That runner is not set up yet. The flow itself is CI-ready — once an emulator
job exists, `maestro test .maestro` (or `npm run e2e:mobile`) is the command to
call after the app is installed on the device.

# ZashboardX Android App

ZashboardX can be packaged as an Android app with Capacitor while keeping the
existing web, Docker, and R5S deployment flows unchanged.

## What this wrapper does

- Bundles the Vite `dist` output into the Android app.
- Runs the existing Vue dashboard inside Capacitor's Android WebView.
- Keeps the web version available at the usual R5S URL.
- Allows cleartext LAN HTTP traffic for self-hosted controllers such as
  `http://192.168.8.1:9090` or `http://192.168.8.2:2080`.

## Commands

```sh
pnpm install
pnpm run android:sync
```

Open the native project in Android Studio:

```sh
pnpm run android:open
```

Build a debug APK from the repository root on Windows:

```powershell
pnpm run android:sync
.\android\gradlew.bat -p android assembleDebug
```

The debug APK will be generated under:

```text
android/app/build/outputs/apk/debug/
```

## Local controller notes

- Do not hard-code Mihomo secrets in the app or repository.
- Configure controller URL and secret through the dashboard settings as usual.
- When away from home, the lightweight setup expects the phone's Clash Party
  TUN/VPN profile to be enabled first. The phone profile routes home LAN CIDRs
  such as `192.168.1.0/24` and `192.168.8.0/24` through the existing home-router
  inbound, so the Android app can keep using the same LAN controller addresses.
- In this lightweight mode, do not expose Mihomo's `9090` controller port
  directly to the public Internet.
- If a controller rejects requests, check its CORS / allowed-origin settings
  because the packaged app runs from Capacitor's local WebView origin.
- For Google Play distribution, prefer HTTPS where practical and add a privacy
  policy plus data-safety disclosures.

## Away-from-home usage

This app wrapper does not include a proxy or VPN client. For the current
lightweight workflow:

1. Start Clash Party on the Android phone and enable its TUN/VPN mode.
2. Confirm the phone profile still routes `192.168.1.0/24` and `192.168.8.0/24`
   to the home-router proxy group.
3. Open the ZashboardX Android app.
4. Configure the dashboard backend to the same LAN Mihomo controller used at
   home, for example the main-router controller IP and port.

Without Clash Party running, LAN addresses such as `192.168.8.x` are not
reachable from outside the home network.

## Store-readiness checklist

- Replace generated launcher assets with final branded icons.
- Add release signing config outside the repository or via CI secrets.
- Build an Android App Bundle (`.aab`) for Play distribution.
- Test on a real Android phone against both LAN and remote controller URLs.

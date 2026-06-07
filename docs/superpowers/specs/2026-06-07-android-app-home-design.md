# Android App Home Design

## Goal

Give the Android wrapper a Neko Dash-inspired home screen while leaving the existing web dashboard, R5S deployment, proxy pages, hover details, long-press details, and mobile scrolling behavior unchanged.

## Scope

- Improve only the native app entry route `#/app`.
- Keep existing routes as the real functional pages after a controller is selected.
- Reuse the existing backend storage model and setup store.
- Preserve off-home access through Clash Party/TUN routing to the home LAN.

## Visual Direction

- Use a light gray app background with soft white rounded cards.
- Use large controller cards with a glowing online/offline indicator.
- Add a compact blue network hint bar for off-home usage.
- Keep quick actions as grouped iOS-style rows.
- Use a rounded bottom sheet for add/edit controller actions.

## User Flow

1. Native app mode opens `#/app` by default.
2. The user sees configured controllers, with the active one highlighted.
3. Tapping a controller activates it and opens the existing proxy dashboard.
4. Tapping the overflow button opens the edit sheet.
5. The add button opens the create sheet with OpenClash LAN defaults.
6. If connection checks fail, the sheet reminds the user to enable Clash Party/TUN before accessing home LAN addresses from outside.

## Data Flow

- Read controllers from `backendList`.
- Read and update the active controller via `activeUuid`.
- Create controllers with `addBackend`.
- Update controllers with `updateBackend`.
- Delete controllers with `removeBackend`.
- Check status with existing controller URLs through `/version` and `/configs`.

## Error Handling

- Treat controllers without host or port as offline.
- Treat timeout or failed status requests as offline.
- Show a focused form error when save-and-connect cannot reach the backend.
- Do not expose or log controller secrets.

## Validation

- Run `pnpm run type-check`.
- Run `pnpm run build`.
- Run `pnpm run android:sync`.
- Preview `http://127.0.0.1:5175/#/app?app=1` when a dev server is available.

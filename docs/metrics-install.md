# Optional Metrics Installation

The ordinary Docker installation remains the default:

```sh
docker run -d -p 80:80 ghcr.io/pluviophile714/zashboardx:latest
```

Use Metrics when you want durable node latency history and availability
metrics. The installer starts two private services:

- `zashboardx`: the browser-facing panel and the only published port.
- `zashboardx-metrics`: the collector and SQLite history store, with no host
  port exposed.

The installer creates a private Compose network and stores history under
`${XDG_DATA_HOME:-$HOME/.local/share}/zashboardx-metrics/metrics-data`.

## Requirements

- Docker Engine with the Docker Compose v2 plugin.
- A Mihomo external-controller URL reachable from the helper container, such
  as `http://192.168.1.1:9090`.
- The Mihomo controller secret, if authentication is enabled.

Do not use `127.0.0.1` for the controller URL unless Mihomo is running inside
the same helper container. For a normal Docker bridge network, use the router
or host LAN address instead. Keep the controller restricted to the LAN and
do not expose it directly to the Internet.

## Install

Run this command on the Docker host:

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/install-metrics.sh | sh
```

The script asks for the panel port, Mihomo controller URL, and optional secret.
The secret is entered without echoing and is stored only in the local `.env`
file with restrictive permissions. No YAML editing or second browser port is
required.

When it finds one recognizable ordinary ZashboardX container from either the
official ZashboardX or upstream image, the script offers to migrate it. A
confirmed migration preserves its published panel port and restart policy,
saves an `inspect` backup, and restores the old container if the new panel
cannot start. Containers with custom mounts, networks, or unfamiliar images
are never taken over automatically.

After startup, open the printed panel URL. Metrics history starts accumulating
from the first successful collection round; it is not retroactively generated.
The panel can still load if the helper cannot reach Mihomo, but its health
endpoint will report the connection problem.

## Update

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/update-metrics.sh | sh
```

Updates pull both images and recreate the managed services without deleting
`metrics-data`.

## Disable

To return to the ordinary panel while retaining the collected history:

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/disable-metrics.sh | sh
```

History is retained so Metrics can be enabled again later. Permanent deletion
requires an explicit confirmation:

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/disable-metrics.sh | sh -s -- --purge-data
```

## Troubleshooting

- **Port already in use:** an official ordinary panel can be migrated after
  confirmation. For every other container, choose another port or stop it
  yourself; the installer never replaces an unrecognized container.
- **Mihomo unreachable:** verify the controller URL is reachable from a
  temporary container and that the controller secret is correct. Rerun the
  installer to update the saved URL or secret without deleting history.
- **No history yet:** allow at least one collection interval. A newly created
  database has no previous samples.

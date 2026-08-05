# Migrating An Existing Installation

## Official ordinary installation

The Metrics installer can migrate one ordinary container when it was started
from `ghcr.io/pluviophile714/zashboardx:latest` or
`ghcr.io/zephyruso/zashboard:latest`, uses the default bridge network, has no
custom bind mounts, and publishes its panel `80/tcp` port. Run the normal
[Metrics installation command](./metrics-install.md#install), confirm the
prompt, and verify the printed panel URL. The script retains an `inspect`
backup in its managed data directory and restores the old container if the new
panel does not become ready.

## Custom installation

The Metrics installer automatically protects containers it does not recognize.
This is intentional: a custom `docker run` or Compose setup may contain mounts,
network settings, certificates, or other services that the installer cannot
reconstruct safely.

## Inspect the existing container

```sh
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
docker inspect <your-container-name>
```

Save any custom port, volume, network, and restart settings before changing it.

## Manual migration

1. Stop the custom panel container yourself.
2. Run the [Metrics installation command](./metrics-install.md#install) and
   choose the same panel port.
3. Verify the panel URL and `/api/metrics/health` before removing anything.
4. Remove the old container only after the new panel is working.

The new Metrics stack keeps its own managed data directory and does not reuse
an arbitrary container's filesystem. If the old panel used a custom config or
TLS proxy, keep that configuration in front of the new panel port.

## Network note

The Mihomo URL is the controller API endpoint, not a path to the Mihomo binary.
For example, a controller listening on the router LAN address might be
`http://192.168.1.1:9090`. It must be reachable from a Docker bridge-networked
container. A controller bound only to `127.0.0.1` on the host will not normally
be reachable from the helper.

Never paste a controller secret into public issue reports, screenshots, or
Compose files committed to a repository.

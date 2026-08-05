# Migrating A Custom Installation

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

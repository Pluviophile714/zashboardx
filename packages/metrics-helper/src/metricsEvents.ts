import type { ServerResponse } from 'node:http'

export type MetricsSnapshotReadyEvent = {
  type: 'snapshot_ready'
  snapshotAt: string
  windowSeconds: number
}

const writeEvent = (response: ServerResponse, eventName: string, data: unknown) => {
  if (!response.writableEnded) {
    response.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

export class MetricsUpdateHub {
  readonly #clients = new Set<ServerResponse>()
  readonly #heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>()

  subscribe(response: ServerResponse) {
    this.#clients.add(response)
    writeEvent(response, 'ready', { type: 'ready' })

    const heartbeatTimer = setInterval(() => {
      if (!response.writableEnded) {
        response.write(': metrics-heartbeat\n\n')
      }
    }, 25_000)

    this.#heartbeatTimers.set(response, heartbeatTimer)
    const cleanup = () => this.#remove(response)

    response.once('close', cleanup)

    return cleanup
  }

  publish(event: MetricsSnapshotReadyEvent) {
    for (const client of this.#clients) {
      writeEvent(client, event.type, event)
    }
  }

  close() {
    for (const client of this.#clients) {
      client.end()
    }

    this.#clients.clear()

    for (const timer of this.#heartbeatTimers.values()) {
      clearInterval(timer)
    }

    this.#heartbeatTimers.clear()
  }

  #remove(response: ServerResponse) {
    this.#clients.delete(response)

    const timer = this.#heartbeatTimers.get(response)

    if (timer) {
      clearInterval(timer)
      this.#heartbeatTimers.delete(response)
    }
  }
}

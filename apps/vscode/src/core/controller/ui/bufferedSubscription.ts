import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"

export function createBufferedSubscription<T>(options: {
	logLabel: string
	registryType: string
	maxPending?: number
}) {
	const subscriptions = new Set<StreamingResponseHandler<T>>()
	const pending: T[] = []
	const maxPending = options.maxPending ?? 10

	const sendTo = async (responseStream: StreamingResponseHandler<T>, event: T): Promise<boolean> => {
		try {
			await responseStream(event, false)
			return true
		} catch (error) {
			Logger.error(`Error sending ${options.logLabel} event:`, error)
			subscriptions.delete(responseStream)
			return false
		}
	}

	return {
		async subscribe(responseStream: StreamingResponseHandler<T>, requestId?: string): Promise<void> {
			subscriptions.add(responseStream)

			const cleanup = () => {
				subscriptions.delete(responseStream)
			}

			if (requestId) {
				getRequestRegistry().registerRequest(requestId, cleanup, { type: options.registryType }, responseStream)
			}

			const queued = pending.splice(0)
			for (let index = 0; index < queued.length; index++) {
				const event = queued[index]
				if (!(await sendTo(responseStream, event))) {
					pending.unshift(event, ...queued.slice(index + 1))
					if (pending.length > maxPending) {
						pending.splice(0, pending.length - maxPending)
					}
					return
				}
			}
		},

		async send(event: T): Promise<void> {
			if (subscriptions.size === 0) {
				pending.push(event)
				if (pending.length > maxPending) {
					pending.splice(0, pending.length - maxPending)
				}
				return
			}

			await Promise.all(Array.from(subscriptions).map((responseStream) => sendTo(responseStream, event)))
		},
	}
}

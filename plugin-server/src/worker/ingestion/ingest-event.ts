import { PluginEvent } from '@posthog/plugin-scaffold'
import * as Sentry from '@sentry/node'
import { DateTime } from 'luxon'

import { Hub, IngestEventResponse } from '../../types'
import { timeoutGuard } from '../../utils/db/utils'
import { status } from '../../utils/status'
import { Action } from './../../types'
import { EventProcessingResult } from './process-event'
import { generateEventDeadLetterQueueMessage } from './utils'

export async function ingestEvent(hub: Hub, event: PluginEvent): Promise<IngestEventResponse> {
    const timeout = timeoutGuard('Still ingesting event inside worker. Timeout warning after 30 sec!', {
        event: JSON.stringify(event),
    })
    try {
        const { ip, site_url, team_id, now, sent_at, uuid } = event
        const distinctId = String(event.distinct_id)
        let result: EventProcessingResult | void
        let success = false

        const maxTries = 20
        let delayUntilNextTryMs = 5
        // Try a few times in case we're running into race conditions or intermittent errors
        // with exponential backoff
        for (let i = 0; i < maxTries && !success; i++) {
            try {
                result = await hub.eventsProcessor.processEvent(
                    distinctId,
                    ip,
                    event,
                    team_id,
                    DateTime.fromISO(now),
                    sent_at ? DateTime.fromISO(sent_at) : null,
                    uuid! // it will throw if it's undefined
                )
                success = true
            } catch (innerError) {
                status.debug('🍿', innerError)
                if (i === maxTries - 1) {
                    throw innerError
                }
                await new Promise((resolve) => setTimeout(resolve, delayUntilNextTryMs))
                delayUntilNextTryMs *= 2
            }
        }

        let actionMatches: Action[] = []

        if (result) {
            const person = await hub.db.fetchPerson(team_id, distinctId)
            actionMatches = await hub.actionMatcher.match(event, person, result.elements)
            await hub.hookCannon.findAndFireHooks(event, person, site_url, actionMatches)

            // eventId is undefined for CH deployments
            // CH deployments calculate actions on the fly
            if (actionMatches.length && result.eventId !== undefined) {
                await hub.db.registerActionMatch(result.eventId, actionMatches)
            }
        }
        // We don't want to return the inserted DB entry that `processEvent` returns.
        // This response is passed to piscina and would be discarded anyway.
        return { actionMatches, success: true }
    } catch (e) {
        status.info('🔔', e)
        Sentry.captureException(e, { extra: { event } })

        if (hub.db.kafkaProducer) {
            try {
                const message = generateEventDeadLetterQueueMessage(event, e)
                await hub.db.kafkaProducer.queueMessage(message)
                hub.statsd?.increment('events_added_to_dead_letter_queue')
            } catch (dlqError) {
                status.info('🔔', `Errored trying to add event ${event.event} to dead letter queue. Error: ${dlqError}`)
                Sentry.captureException(e, { extra: { event } })
            }
        }
        return { error: e.message }
    } finally {
        clearTimeout(timeout)
    }
}

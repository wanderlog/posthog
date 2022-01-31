import { Properties } from '@posthog/plugin-scaffold'
import { KafkaMessage, ProducerRecord } from 'kafkajs'
import { DateTime } from 'luxon'
import { PoolClient, QueryResult } from 'pg'

import {
    Group,
    GroupTypeIndex,
    Person,
    PropertiesLastOperation,
    PropertiesLastUpdatedAt,
    PropertyUpdateOperation,
    TeamId,
} from '../../types'
import { DB } from '../../utils/db/db'
import { generateKafkaPersonUpdateMessage } from '../../utils/db/utils'
import { RaceConditionError } from '../../utils/utils'

interface PropertiesUpdate {
    updated: boolean
    properties: Properties
    properties_last_updated_at: PropertiesLastUpdatedAt
    properties_last_operation: PropertiesLastOperation
}

export async function updatePersonProperties(
    db: DB,
    teamId: TeamId,
    distinctId: string,
    properties: Properties,
    propertiesOnce: Properties,
    timestamp: DateTime
): Promise<void> {
    if (Object.keys(properties).length === 0 && Object.keys(propertiesOnce).length === 0) {
        return
    }

    const [propertiesUpdate, person] = await db.postgresTransaction(async (client) => {
        const person = await db.fetchPerson(teamId, distinctId, client, { forUpdate: true })
        if (!person) {
            throw new Error(
                `Could not find person with distinct id "${distinctId}" in team "${teamId}" to update props`
            )
        }

        const propertiesUpdate: PropertiesUpdate = calculateUpdate(
            person.properties,
            properties,
            propertiesOnce,
            person.properties_last_updated_at,
            person.properties_last_operation || {},
            timestamp
        )
        if (propertiesUpdate.updated || timestamp < person.created_at) {
            person.version = await db.updatePerson(
                client,
                person.id,
                DateTime.min(timestamp, person.created_at),
                propertiesUpdate.properties,
                propertiesUpdate.properties_last_updated_at,
                propertiesUpdate.properties_last_operation
            )
        }
        return [propertiesUpdate, person]
    })

    if (db.kafkaProducer && propertiesUpdate.updated) {
        const kafkaMessage = generateKafkaPersonUpdateMessage(
            timestamp,
            propertiesUpdate.properties,
            person.team_id,
            person.is_identified,
            person.uuid,
            person.version
        )
        await db.kafkaProducer.queueMessage(kafkaMessage)
    }
}

export async function mergePersonProperties(
    db: DB,
    client: PoolClient,
    primaryPerson: Person,
    secondaryPerson: Person,
    timestamp: DateTime
): Promise<ProducerRecord[]> {
    // Assuming we have locked both person's rows for update
    const propertiesUpdate: PropertiesUpdate = calculateUpdateForMerge(
        primaryPerson.properties,
        primaryPerson.properties_last_updated_at,
        primaryPerson.properties_last_operation || {},
        secondaryPerson.properties,
        secondaryPerson.properties_last_updated_at,
        secondaryPerson.properties_last_operation || {}
    )

    if (propertiesUpdate.updated) {
        const version = await db.updatePerson(
            client,
            primaryPerson.id,
            timestamp,
            propertiesUpdate.properties,
            propertiesUpdate.properties_last_updated_at,
            propertiesUpdate.properties_last_operation
        )

        if (db.kafkaProducer && propertiesUpdate.updated) {
            return [
                generateKafkaPersonUpdateMessage(
                    timestamp,
                    propertiesUpdate.properties,
                    primaryPerson.team_id,
                    primaryPerson.is_identified || secondaryPerson.is_identified,
                    primaryPerson.uuid,
                    version
                ),
            ]
        }
    }
    return []
}

export async function upsertGroup(
    db: DB,
    teamId: TeamId,
    groupTypeIndex: GroupTypeIndex,
    groupKey: string,
    properties: Properties,
    timestamp: DateTime
): Promise<void> {
    try {
        const [propertiesUpdate, createdAt, version] = await db.postgresTransaction(async (client) => {
            const group: Group | undefined = await db.fetchGroup(teamId, groupTypeIndex, groupKey, client, {
                forUpdate: true,
            })
            const createdAt = DateTime.min(group?.created_at || DateTime.now(), timestamp)
            const version = (group?.version || 0) + 1

            const propertiesUpdate = calculateUpdate(
                group?.group_properties || {},
                properties,
                {},
                group?.properties_last_updated_at || {},
                group?.properties_last_operation || {},
                timestamp
            )

            if (!group) {
                propertiesUpdate.updated = true
            }

            if (propertiesUpdate.updated) {
                if (group) {
                    await db.updateGroup(
                        teamId,
                        groupTypeIndex,
                        groupKey,
                        propertiesUpdate.properties,
                        createdAt,
                        propertiesUpdate.properties_last_updated_at,
                        propertiesUpdate.properties_last_operation,
                        version,
                        client
                    )
                } else {
                    // :TRICKY: insertGroup will raise a RaceConditionError if group was inserted in-between fetch and this
                    await db.insertGroup(
                        teamId,
                        groupTypeIndex,
                        groupKey,
                        propertiesUpdate.properties,
                        createdAt,
                        propertiesUpdate.properties_last_updated_at,
                        propertiesUpdate.properties_last_operation,
                        version,
                        client
                    )
                }
            }

            return [propertiesUpdate, createdAt, version]
        })

        if (propertiesUpdate.updated) {
            await db.upsertGroupClickhouse(
                teamId,
                groupTypeIndex,
                groupKey,
                propertiesUpdate.properties,
                createdAt,
                version
            )
        }
    } catch (error) {
        if (error instanceof RaceConditionError) {
            // Try again - lock the row and insert!
            return upsertGroup(db, teamId, groupTypeIndex, groupKey, properties, timestamp)
        }
        throw error
    }
}

export function shouldUpdateProperty(
    operation: PropertyUpdateOperation,
    timestamp: DateTime,
    lastOperation: PropertyUpdateOperation,
    lastTimestamp: DateTime
): boolean {
    if (
        operation == PropertyUpdateOperation.SetOnce &&
        lastOperation === PropertyUpdateOperation.SetOnce &&
        lastTimestamp > timestamp
    ) {
        return true
    }
    if (
        operation == PropertyUpdateOperation.Set &&
        (lastOperation === PropertyUpdateOperation.SetOnce || lastTimestamp < timestamp)
    ) {
        return true
    }
    return false
}

export function calculateUpdateSingleProperty(
    result: PropertiesUpdate,
    key: string,
    value: any,
    operation: PropertyUpdateOperation,
    timestamp: DateTime,
    currentPropertiesLastOperation: PropertiesLastOperation,
    currentPropertiesLastUpdatedAt: PropertiesLastUpdatedAt
): void {
    if (
        !(key in result.properties) ||
        shouldUpdateProperty(
            operation,
            timestamp,
            getPropertiesLastOperationOrSet(currentPropertiesLastOperation, key),
            getPropertyLastUpdatedAtDateTimeOrEpoch(currentPropertiesLastUpdatedAt, key)
        )
    ) {
        result.updated = true
        result.properties[key] = value
        result.properties_last_operation[key] = operation
        result.properties_last_updated_at[key] = timestamp.toISO()
    }
}

export function calculateUpdateForMerge(
    currentProperties: Properties,
    currentPropertiesLastUpdatedAt: PropertiesLastUpdatedAt,
    currentPropertiesLastOperation: PropertiesLastOperation,
    newProperties: Properties,
    newPropertiesLastUpdatedAt: PropertiesLastUpdatedAt,
    newPropertiesLastOperation: PropertiesLastOperation
): PropertiesUpdate {
    const result: PropertiesUpdate = {
        updated: false,
        properties: { ...currentProperties },
        properties_last_updated_at: { ...currentPropertiesLastUpdatedAt },
        properties_last_operation: { ...currentPropertiesLastOperation },
    }

    Object.entries(newProperties).forEach(([key, value]) => {
        const operation = getPropertiesLastOperationOrSet(newPropertiesLastOperation, key)
        const timestamp = getPropertyLastUpdatedAtDateTimeOrEpoch(newPropertiesLastUpdatedAt, key)
        calculateUpdateSingleProperty(
            result,
            key,
            value,
            operation,
            timestamp,
            currentPropertiesLastOperation,
            currentPropertiesLastUpdatedAt
        )
    })
    return result
}

export function calculateUpdate(
    currentProperties: Properties,
    properties: Properties,
    propertiesOnce: Properties,
    currentPropertiesLastUpdatedAt: PropertiesLastUpdatedAt,
    currentPropertiesLastOperation: PropertiesLastOperation,
    timestamp: DateTime
): PropertiesUpdate {
    const result: PropertiesUpdate = {
        updated: false,
        properties: { ...currentProperties },
        properties_last_updated_at: { ...currentPropertiesLastUpdatedAt },
        properties_last_operation: { ...currentPropertiesLastOperation },
    }

    const allProperties: [Properties, PropertyUpdateOperation][] = [
        [propertiesOnce, PropertyUpdateOperation.SetOnce],
        [properties, PropertyUpdateOperation.Set],
    ]
    allProperties.forEach(([props, operation]) => {
        Object.entries(props).forEach(([key, value]) => {
            calculateUpdateSingleProperty(
                result,
                key,
                value,
                operation,
                timestamp,
                currentPropertiesLastOperation,
                currentPropertiesLastUpdatedAt
            )
        })
    })
    return result
}

function getPropertyLastUpdatedAtDateTimeOrEpoch(
    propertiesLastUpdatedAt: PropertiesLastUpdatedAt,
    key: string
): DateTime {
    const lookup = propertiesLastUpdatedAt[key]
    if (lookup) {
        return DateTime.fromISO(lookup)
    }
    return DateTime.fromMillis(0)
}

function getPropertiesLastOperationOrSet(
    propertiesLastOperation: PropertiesLastOperation,
    key: string
): PropertyUpdateOperation {
    if (!(key in propertiesLastOperation)) {
        return PropertyUpdateOperation.Set
    }
    return propertiesLastOperation[key]
}

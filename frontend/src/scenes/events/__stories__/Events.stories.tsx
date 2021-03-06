import { Meta } from '@storybook/react'

import { EventsTable } from 'scenes/events'
import React from 'react'
import { mswDecorator } from '~/mocks/browser'
import eventList from './eventList.json'

export default {
    title: 'Scenes/Events',
    decorators: [
        mswDecorator({
            get: { '/api/projects/1/events': { next: null, results: eventList } },
        }),
    ],
} as Meta

export const AllEvents = (): JSX.Element => {
    return <EventsTable pageKey="EventsTable" sceneUrl="/" />
}

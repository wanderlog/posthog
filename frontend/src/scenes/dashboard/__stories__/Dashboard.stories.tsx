import React from 'react'
import { Meta } from '@storybook/react'
import { mswDecorator } from '~/mocks/browser'
import { Dashboard } from '../Dashboard'

export default {
    title: 'Scenes/Dashboard',
    decorators: [
        mswDecorator({
            get: {
                '/api/projects/1/dashboards/': require('./dashboards.json'),
                '/api/projects/1/dashboards/1/': require('./dashboard1.json'),
                '/api/projects/1/dashboards/1/collaborators/': [],
            },
        }),
    ],
} as Meta

export const Default = (): JSX.Element => {
    return <Dashboard id={'1'} />
}

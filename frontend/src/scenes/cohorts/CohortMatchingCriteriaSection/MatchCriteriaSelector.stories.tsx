import React, { useState } from 'react'
import { ComponentMeta } from '@storybook/react'
import { Provider } from 'kea'
import { MatchCriteriaSelector, MatchCriteriaSelectorProps } from './MatchCriteriaSelector'
import { CohortGroupType } from '~/types'
import { makeCohortGroupType } from '../cohortGroupType'

export default {
    title: 'PostHog/Components/Cohorts/MatchCriteriaSelector',
    Component: MatchCriteriaSelector,
} as ComponentMeta<typeof MatchCriteriaSelector>

const props: MatchCriteriaSelectorWrapperProps = {
    group: {
        ...makeCohortGroupType(),
        matchType: 'entities',
    },
    onRemove: () => console.log('onRemove'),
}

export const PerformedActionOrEvent = (): JSX.Element => {
    return <MatchCriteriaSelectorWrapper {...props} />
}

export const PerformedActionOrEventBetween = (): JSX.Element => {
    return (
        <MatchCriteriaSelectorWrapper
            {...props}
            group={{
                ...props.group,
                start_date: '2022-01-01',
                end_date: '2022-01-05',
            }}
        />
    )
}

type MatchCriteriaSelectorWrapperProps = Omit<MatchCriteriaSelectorProps, 'onCriteriaChange'>

function MatchCriteriaSelectorWrapper(wrapperProps: MatchCriteriaSelectorWrapperProps): JSX.Element {
    const [criteria, setCriteria] = useState<CohortGroupType>(wrapperProps.group)

    const handleCriteriaChange = (partial: Partial<CohortGroupType>): void => {
        console.log('criteria changed', partial)
        setCriteria((curCriteria) => ({ ...curCriteria, ...partial }))
    }

    return (
        <Provider>
            <MatchCriteriaSelector {...wrapperProps} group={criteria} onCriteriaChange={handleCriteriaChange} />
        </Provider>
    )
}

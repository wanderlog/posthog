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
    onRemove: () => console.log('onRemove'),
}

export const Default = (): JSX.Element => {
    return <MatchCriteriaSelectorWrapper {...props} />
}

type MatchCriteriaSelectorWrapperProps = Omit<MatchCriteriaSelectorProps, 'group' | 'onCriteriaChange'>

function MatchCriteriaSelectorWrapper(wrapperProps: MatchCriteriaSelectorWrapperProps): JSX.Element {
    const [criteria, setCriteria] = useState<CohortGroupType>({
        ...makeCohortGroupType(),
        matchType: 'entities',
    })

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

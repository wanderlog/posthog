import React from 'react'
import { TaxonomicFilter } from '../TaxonomicFilter'
import { personPropertiesModel } from '~/models/personPropertiesModel'
import { cohortsModel } from '~/models/cohortsModel'
import { TaxonomicFilterGroupType } from 'lib/components/TaxonomicFilter/types'
import { taxonomicFilterMocksDecorator } from 'lib/components/TaxonomicFilter/__stories__/mocks'
import { useMountedLogic } from 'kea'

export default {
    title: 'Filters/TaxonomicFilter',
    decorators: [taxonomicFilterMocksDecorator],
}

export const AllGroups = (): JSX.Element => {
    useMountedLogic(personPropertiesModel)
    useMountedLogic(cohortsModel)

    return (
        <TaxonomicFilter
            taxonomicGroupTypes={[
                TaxonomicFilterGroupType.EventProperties,
                TaxonomicFilterGroupType.PersonProperties,
                TaxonomicFilterGroupType.Cohorts,
            ]}
        />
    )
}

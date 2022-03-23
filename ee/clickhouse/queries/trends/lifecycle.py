from datetime import datetime
from typing import Callable, Dict, List, Tuple

from django.db.models.query import Prefetch
from rest_framework.request import Request

from ee.clickhouse.client import sync_execute
from ee.clickhouse.models.entity import get_entity_filtering_params
from ee.clickhouse.models.person import get_persons_by_uuids
from ee.clickhouse.queries.event_query import ClickhouseEventQuery
from ee.clickhouse.queries.person_query import ClickhousePersonQuery
from ee.clickhouse.queries.trends.util import parse_response
from ee.clickhouse.queries.util import parse_timestamps
from ee.clickhouse.sql.trends.lifecycle import LIFECYCLE_PEOPLE_SQL, LIFECYCLE_SQL
from posthog.models.entity import Entity
from posthog.models.filters import Filter
from posthog.models.filters.mixins.utils import cached_property

# Lifecycle takes an event/action, time range, interval and for every period, splits the users who did the action into 4:
#
# 1. NEW - Users who did the action during interval and were also created during that period
# 2. RESURRECTING - Users who did the action during this interval, but not one prior
# 3. RETURNING - Users who did the action during this interval and prior one
# 4. DORMANT - Users who did not do the action during this period but did an action the previous period
#
# To do this, we need for every period (+1 prior to the first period), list of person_ids who did the event/action
# during that period and their creation dates.


class ClickhouseLifecycle:
    def _format_lifecycle_query(self, entity: Entity, filter: Filter, team_id: int) -> Tuple[str, Dict, Callable]:
        event_query, event_params = LifecycleEventQuery(team_id=team_id, filter=filter).get_query()

        return (
            LIFECYCLE_SQL.format(events_query=event_query, interval_expr=filter.interval),
            event_params,
            self._parse_result(filter, entity),
        )

    def _parse_result(self, filter: Filter, entity: Entity) -> Callable:
        def _parse(result: List) -> List:
            res = []
            for val in result:
                label = "{} - {}".format(entity.name, val[2])
                additional_values = {"label": label, "status": val[2]}
                parsed_result = parse_response(val, filter, additional_values)
                res.append(parsed_result)

            return res

        return _parse

    def get_people(
        self,
        filter: Filter,
        team_id: int,
        target_date: datetime,
        lifecycle_type: str,
        request: Request,
        limit: int = 100,
    ):
        event_query, event_params = LifecycleEventQuery(team_id=team_id, filter=filter).get_query()

        result = sync_execute(
            LIFECYCLE_PEOPLE_SQL.format(events_query=event_query, interval_expr=filter.interval),
            {
                **event_params,
                "status": lifecycle_type,
                "target_date": target_date,
                "offset": filter.offset,
                "limit": limit,
            },
        )
        people = get_persons_by_uuids(team_id=team_id, uuids=[p[0] for p in result])
        people = people.prefetch_related(Prefetch("persondistinctid_set", to_attr="distinct_ids_cache"))

        from posthog.api.person import PersonSerializer

        return PersonSerializer(people, many=True).data


class LifecycleEventQuery(ClickhouseEventQuery):
    _filter: Filter

    def get_query(self):
        date_query, date_params = self._get_date_filter()
        self.params.update(date_params)

        prop_query, prop_params = self._get_prop_groups(self._filter.property_groups)

        self.params.update(prop_params)

        entity_params, entity_format_params = get_entity_filtering_params(
            entity=self._filter.entities[0], team_id=self._team_id, table_name=self.EVENT_TABLE_ALIAS
        )
        self.params.update(entity_params)
        entity_query = entity_format_params.get("entity_query")

        distinct_id_query, distinct_id_params = self._get_distinct_id_query(
            entity_query=entity_query, date_query=date_query
        )
        self.params.update(distinct_id_params)

        person_query, person_params = self._get_person_query(entity_query=entity_query, date_query=date_query)
        self.params.update(person_params)

        groups_query, groups_params = self._get_groups_query()
        self.params.update(groups_params)

        return (
            f"""
            SELECT DISTINCT
                person_id,
                toDateTime(dateTrunc(%(interval)s, events.timestamp)) AS period,
                person.created_at AS created_at
            FROM events AS {self.EVENT_TABLE_ALIAS}
            {distinct_id_query}
            {person_query}
            {groups_query}
            WHERE team_id = %(team_id)s
            {entity_format_params["entity_query"]}
            {date_query}
            {prop_query}
        """,
            self.params,
        )

    @cached_property
    def _person_query(self):
        return ClickhousePersonQuery(self._filter, self._team_id, self._column_optimizer, extra_fields=["created_at"],)

    def _get_date_filter(self):
        _, _, date_params = parse_timestamps(filter=self._filter, team_id=self._team_id)
        params = {**date_params, "interval": self._filter.interval}
        # :TRICKY: We fetch all data even for the period before the graph starts up until the end of the last period
        return (
            f"""
            AND timestamp >= toDateTime(dateTrunc(%(interval)s, toDateTime(%(date_from)s))) - INTERVAL 1 {self._filter.interval}
            AND timestamp < toDateTime(dateTrunc(%(interval)s, toDateTime(%(date_to)s))) + INTERVAL 1 {self._filter.interval}
        """,
            params,
        )

    def _determine_should_join_distinct_ids(self) -> None:
        self._should_join_distinct_ids = True

    def _determine_should_join_persons(self) -> None:
        self._should_join_persons = True

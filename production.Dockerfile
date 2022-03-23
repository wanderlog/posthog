# To deploy:
# 1. Edit Dockerfile as desired
# 2. Log in to docker if you haven't: `docker login --username=wanderlog`. Enter the password for the account
# 3. Change to this directory (the one container the Dockerfile)
# 4. `docker pull posthog/posthog:release-1.33.0 && docker build --tag=wanderlog/posthog:release-1.33.0 . && docker push wanderlog/posthog:release-1.33.0`

FROM posthog/posthog:release-1.33.0

COPY ee/clickhouse/models/test/test_property.py /home/posthog/code/ee/clickhouse/models/test/
COPY ee/clickhouse/queries/breakdown_props.py ee/clickhouse/queries/event_query.py ee/clickhouse/queries/person_distinct_id_query.py ee/clickhouse/queries/person_query.py /home/posthog/code/ee/clickhouse/queries/
COPY ee/clickhouse/queries/funnels/funnel_correlation.py ee/clickhouse/queries/funnels/funnel_correlation_persons.py ee/clickhouse/queries/funnels/funnel_event_query.py /home/posthog/code/ee/clickhouse/queries/funnels/
COPY ee/clickhouse/queries/paths/path_event_query.py /home/posthog/code/ee/clickhouse/queries/paths/
COPY ee/clickhouse/queries/retention/retention_event_query.py /home/posthog/code/ee/clickhouse/queries/retention/
COPY ee/clickhouse/queries/stickiness/stickiness_event_query.py /home/posthog/code/ee/clickhouse/queries/stickiness/
COPY ee/clickhouse/queries/trends/breakdown.py ee/clickhouse/queries/trends/lifecycle.py ee/clickhouse/queries/trends/trend_event_query.py /home/posthog/code/ee/clickhouse/queries/trends/
COPY ee/clickhouse/sql/person.py /home/posthog/code/ee/clickhouse/sql/
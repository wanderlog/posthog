import dataclasses
import json
from typing import Any, List, Literal, Optional, Union

from django.db import models
from django.utils import timezone

from posthog.models.user import User
from posthog.models.utils import UUIDT, UUIDModel


@dataclasses.dataclass(frozen=True)
class Change:
    type: Literal["FeatureFlag"]
    action: Literal["imported", "changed", "created", "deleted"]
    field: Optional[str] = None
    before: Optional[Any] = None
    after: Optional[Any] = None


@dataclasses.dataclass(frozen=True)
class Detail:
    changes: Optional[List[Change]] = None


class ActivityDetailEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Detail):
            return obj.__dict__
        if isinstance(obj, Change):
            return obj.__dict__

        return json.JSONEncoder.default(self, obj)


class ActivityLog(UUIDModel):
    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(team_id__isnull=False) | models.Q(organization_id__isnull=False),
                name="must_have_team_or_organization_id",
            ),
        ]
        indexes = [
            models.Index(fields=["team_id", "item_type", "item_id"]),
        ]

    team_id = models.PositiveIntegerField(null=True)
    organization_id = models.UUIDField(null=True)
    user = models.ForeignKey("posthog.User", null=True, on_delete=models.SET_NULL)
    activity = models.fields.CharField(max_length=79, null=False)
    # the id of the item being versioned
    # this might be a numerical id, short id, or UUID, so each will be converted to string
    # it will be used to lookup rows with exactly matching item_ids
    # it probably only needs to be 36 characters in order to hold a GUID
    # but 72 may be useful to avoid a migration in future
    item_id = models.fields.CharField(max_length=72, null=False)
    # e.g. FeatureFlags - in practice this will be the name of a model class
    item_type = models.fields.CharField(max_length=79, null=False)
    detail = models.JSONField(encoder=ActivityDetailEncoder, null=True)
    created_at: models.DateTimeField = models.DateTimeField(default=timezone.now)


def changes_between(
    model_type: Literal["FeatureFlag"], previous: Optional[models.Model], current: Optional[models.Model]
) -> List[Change]:
    """
    Identifies changes between two models by comparing fields
    """
    changes: List[Change] = []

    if previous is None and current is None:
        # there are no changes between two things that don't exist
        return changes

    if previous is not None:
        fields = current._meta.fields if current is not None else []

        for field in [f.name for f in fields]:
            left = getattr(previous, field, None)
            right = getattr(current, field, None)

            if left is None and right is not None:
                changes.append(Change(type=model_type, field=field, action="created", after=right,))
            elif right is None and left is not None:
                changes.append(Change(type=model_type, field=field, action="deleted", before=left,))
            elif left != right:
                changes.append(Change(type=model_type, field=field, action="changed", before=left, after=right,))

    return changes


def log_activity(
    organization_id: UUIDT,
    team_id: int,
    user: User,
    item_id: Union[int, str, UUIDT],
    item_type: str,
    activity: str,
    detail: Detail,
) -> None:
    ActivityLog.objects.create(
        organization_id=organization_id,
        team_id=team_id,
        user=user,
        item_id=str(item_id),
        item_type=item_type,
        activity=activity,
        detail=detail,
    )


def load_activity(type: Literal["FeatureFlag"], team_id: int, item_id: int):
    activities = list(
        ActivityLog.objects.select_related("user")
        .filter(team_id=team_id, item_type=type, item_id=item_id)
        .order_by("-created_at")[:10]
    )

    return activities
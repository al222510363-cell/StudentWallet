"""Pydantic schemas used to validate API request and response bodies."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TransactionBase(BaseModel):
    description: str = Field(min_length=1, max_length=70)
    type: Literal["income", "expense"]
    category: str = Field(min_length=1, max_length=40)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    date: date
    note: str = Field(default="", max_length=160)

    @field_validator("description", "category", "note")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("description", "category")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value:
            raise ValueError("Este campo no puede estar vacío.")
        return value


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(TransactionBase):
    pass


class TransactionResponse(TransactionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class BudgetPayload(BaseModel):
    """Validate a monthly spending limit for one expense category."""

    category: str = Field(min_length=1, max_length=40)
    limit_amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    period_start: date

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La categoría no puede estar vacía.")
        return value

    @field_validator("period_start")
    @classmethod
    def validate_period_start(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("period_start debe ser el primer día del mes seleccionado.")
        return value


class SavingsGoalPayload(BaseModel):
    """Validate the editable information for a savings goal."""

    title: str = Field(min_length=1, max_length=90)
    description: str = Field(default="", max_length=200)
    target_amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    target_date: date | None = None

    @field_validator("title", "description")
    @classmethod
    def strip_goal_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("title")
    @classmethod
    def reject_blank_goal_title(cls, value: str) -> str:
        if not value:
            raise ValueError("El nombre de la meta no puede estar vacío.")
        return value


class SavingsContributionPayload(BaseModel):
    """Validate a deposit made toward a savings goal."""

    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    contribution_date: date = Field(default_factory=date.today)
    note: str = Field(default="", max_length=160)

    @field_validator("note")
    @classmethod
    def strip_contribution_note(cls, value: str) -> str:
        return value.strip()


class AssistantChatRequest(BaseModel):
    """Validate a financial question and optional conversation/period context."""

    question: str = Field(min_length=1, max_length=1000)
    period: Literal["general", "week", "month"] = "general"
    reference_date: date | None = None
    conversation_id: int | None = Field(default=None, ge=1)

    @field_validator("question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La pregunta no puede estar vacía.")
        return value


class ConversationMessageResponse(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    model_used: str | None = None
    period: Literal["general", "week", "month"] | None = None
    reference_date: date | None = None
    created_at: datetime


class ConversationSummaryResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationDetailResponse(ConversationSummaryResponse):
    messages: list[ConversationMessageResponse]


class AchievementProgressResponse(BaseModel):
    current: int
    target: int
    percent: int
    detail: str


class AchievementUnlockNotice(BaseModel):
    code: str
    title: str
    points: int


class AchievementItemResponse(BaseModel):
    code: str
    title: str
    description: str
    requirement: str
    category: str
    points: int
    symbol: str
    unlocked: bool
    unlocked_at: datetime | None = None
    progress: AchievementProgressResponse


class AchievementLevelResponse(BaseModel):
    number: int
    name: str
    points: int
    points_to_next_level: int
    next_level_name: str | None = None
    progress_percent: int


class AchievementsResponse(BaseModel):
    points: int
    unlocked_count: int
    total_achievements: int
    level: AchievementLevelResponse
    achievements: list[AchievementItemResponse]
    newly_unlocked: list[AchievementUnlockNotice]

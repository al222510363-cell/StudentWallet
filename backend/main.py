"""StudentWallet REST API and static frontend server."""

import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg2 import Error as PsycopgError
from psycopg2.extras import RealDictCursor

from backend.database import (
    DatabaseConfigurationError,
    check_database_connection,
    get_connection,
    initialize_database,
)
from backend.schemas import (
    AchievementItemResponse,
    AchievementsResponse,
    AssistantChatRequest,
    BudgetPayload,
    SavingsContributionPayload,
    SavingsGoalPayload,
    TransactionCreate,
    TransactionUpdate,
)
from backend.gemini_service import ask_gemini

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Prepare the database before accepting requests."""
    try:
        initialize_database()
    except DatabaseConfigurationError:
        raise
    except PsycopgError as exc:
        raise RuntimeError(
            "No se pudo conectar con PostgreSQL. Verifica que el servicio esté activo, "
            "que la base studentwallet exista y que DATABASE_URL sea correcta."
        ) from exc
    yield


app = FastAPI(
    title="StudentWallet API",
    description=(
        "API REST para administrar las finanzas de StudentWallet. "
        "Incluye operaciones GET, POST, PUT y DELETE, análisis por periodo, "
        "historial de conversaciones, presupuestos mensuales, metas de ahorro, logros e insignias e integración con Google Gemini AI."
    ),
    version="0.9.0",
    lifespan=lifespan,
)


def query_all(sql: str, params: tuple[Any, ...] | list[Any] = ()) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()


def query_one(sql: str, params: tuple[Any, ...] | list[Any] = ()) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()


def serialize_transaction(row: dict[str, Any]) -> dict[str, Any]:
    """Convert PostgreSQL date/Decimal values into JSON-friendly values."""
    return {
        "id": row["id"],
        "description": row["description"],
        "type": row["type"],
        "category": row["category"],
        "amount": float(Decimal(row["amount"])),
        "date": row["date"].isoformat() if isinstance(row["date"], date) else str(row["date"]),
        "note": row["note"] or "",
    }


def serialize_conversation(row: dict[str, Any]) -> dict[str, Any]:
    """Convert conversation timestamps into JSON-friendly values."""
    return {
        "id": row["id"],
        "title": row["title"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "message_count": int(row.get("message_count", 0)),
    }


def serialize_chat_message(row: dict[str, Any]) -> dict[str, Any]:
    """Convert message dates/timestamps for a JSON response."""
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "model_used": row["model_used"],
        "period": row["period"],
        "reference_date": row["reference_date"].isoformat() if row["reference_date"] else None,
        "created_at": row["created_at"].isoformat(),
    }


@app.get("/api/health", tags=["Sistema"])
def health_check() -> dict[str, str]:
    """Check that both the API and PostgreSQL are available."""
    try:
        check_database_connection()
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"Base de datos no disponible: {exc}") from exc
    return {"status": "ok", "database": "connected"}


@app.get("/api/transactions", tags=["Movimientos"])
def list_transactions(
    search: str | None = Query(default=None, max_length=100),
    transaction_type: str | None = Query(default=None, alias="type", pattern="^(income|expense)$"),
    category: str | None = Query(default=None, max_length=40),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
) -> list[dict[str, Any]]:
    """Return transactions filtered by text, type, category and date range."""
    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha inicial no puede ser posterior a la fecha final.",
        )

    query = """
        SELECT id, description, type, category, amount, date, note
        FROM transactions
        WHERE TRUE
    """
    params: list[Any] = []
    if search:
        query += " AND (description ILIKE %s OR category ILIKE %s OR note ILIKE %s)"
        pattern = f"%{search.strip()}%"
        params.extend([pattern, pattern, pattern])
    if transaction_type:
        query += " AND type = %s"
        params.append(transaction_type)
    if category:
        query += " AND category = %s"
        params.append(category)
    if start_date:
        query += " AND date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND date <= %s"
        params.append(end_date)
    query += " ORDER BY date DESC, id DESC"

    try:
        rows = query_all(query, params)
        return [serialize_transaction(row) for row in rows]
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible consultar movimientos: {exc}") from exc


@app.get("/api/transactions/{transaction_id}", tags=["Movimientos"])
def get_transaction(transaction_id: int) -> dict[str, Any]:
    """Return one transaction by its database ID."""
    try:
        row = query_one(
            """SELECT id, description, type, category, amount, date, note
               FROM transactions WHERE id = %s""",
            (transaction_id,),
        )
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible consultar el movimiento: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado.")
    return serialize_transaction(row)


@app.post("/api/transactions", status_code=status.HTTP_201_CREATED, tags=["Movimientos"])
def create_transaction(payload: TransactionCreate) -> dict[str, Any]:
    """Create an income or expense transaction."""
    try:
        with get_connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """INSERT INTO transactions (description, type, category, amount, date, note)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       RETURNING id, description, type, category, amount, date, note""",
                    (
                        payload.description,
                        payload.type,
                        payload.category,
                        payload.amount,
                        payload.date,
                        payload.note,
                    ),
                )
                row = cursor.fetchone()
        return serialize_transaction(row)
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible registrar el movimiento: {exc}") from exc


@app.put("/api/transactions/{transaction_id}", tags=["Movimientos"])
def update_transaction(transaction_id: int, payload: TransactionUpdate) -> dict[str, Any]:
    """Replace the editable fields of an existing transaction."""
    try:
        with get_connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """UPDATE transactions
                       SET description = %s, type = %s, category = %s,
                           amount = %s, date = %s, note = %s, updated_at = NOW()
                       WHERE id = %s
                       RETURNING id, description, type, category, amount, date, note""",
                    (
                        payload.description,
                        payload.type,
                        payload.category,
                        payload.amount,
                        payload.date,
                        payload.note,
                        transaction_id,
                    ),
                )
                row = cursor.fetchone()
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible actualizar el movimiento: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado.")
    return serialize_transaction(row)


@app.delete("/api/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Movimientos"])
def delete_transaction(transaction_id: int) -> Response:
    """Delete one transaction."""
    try:
        row = query_one("DELETE FROM transactions WHERE id = %s RETURNING id", (transaction_id,))
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible eliminar el movimiento: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)



# ---------------------------- Presupuestos mensuales ----------------------------


def _budget_select_sql() -> str:
    """Return a budget row with expenses calculated for its category and month."""
    return """
        SELECT
            b.id,
            b.category,
            b.limit_amount,
            b.period_start,
            b.created_at,
            b.updated_at,
            COALESCE((
                SELECT SUM(t.amount)
                FROM transactions AS t
                WHERE t.type = 'expense'
                  AND t.category = b.category
                  AND t.date >= b.period_start
                  AND t.date < (b.period_start + INTERVAL '1 month')::date
            ), 0) AS spent
        FROM budgets AS b
    """


def serialize_budget(row: dict[str, Any]) -> dict[str, Any]:
    """Add spending progress and remaining balance to a stored budget."""
    limit_amount = Decimal(str(row["limit_amount"]))
    spent = Decimal(str(row.get("spent", 0) or 0))
    remaining = limit_amount - spent
    percent_used = (spent / limit_amount * Decimal("100")) if limit_amount > 0 else Decimal("0")

    if percent_used >= 100:
        budget_status = "exceeded"
    elif percent_used >= 80:
        budget_status = "warning"
    else:
        budget_status = "on_track"

    return {
        "id": int(row["id"]),
        "category": row["category"],
        "limit_amount": float(limit_amount),
        "spent": float(spent),
        "remaining": float(remaining),
        "percent_used": round(float(percent_used), 1),
        "status": budget_status,
        "period_start": row["period_start"].isoformat(),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def get_budget_row(budget_id: int) -> dict[str, Any] | None:
    """Retrieve one budget together with its current month's expenses."""
    return query_one(
        _budget_select_sql() + " WHERE b.id = %s",
        (budget_id,),
    )


@app.get("/api/budgets", tags=["Presupuestos"])
def list_budgets(
    month: date | None = Query(
        default=None,
        description="Cualquier fecha del mes que se desea consultar; se normaliza al primer día.",
    ),
) -> dict[str, Any]:
    """List monthly budgets and calculate actual expenses by category."""
    selected_month = (month or date.today()).replace(day=1)
    try:
        rows = query_all(
            _budget_select_sql() + " WHERE b.period_start = %s ORDER BY b.category ASC",
            (selected_month,),
        )
        budgets = [serialize_budget(row) for row in rows]
        total_limit = sum((Decimal(str(row["limit_amount"])) for row in rows), Decimal("0.00"))
        total_spent = sum((Decimal(str(row.get("spent", 0) or 0)) for row in rows), Decimal("0.00"))
        total_remaining = total_limit - total_spent
        total_percent = (total_spent / total_limit * Decimal("100")) if total_limit > 0 else Decimal("0")
        return {
            "month": selected_month.strftime("%Y-%m"),
            "budgets": budgets,
            "summary": {
                "total_limit": float(total_limit),
                "total_spent": float(total_spent),
                "total_remaining": float(total_remaining),
                "percent_used": round(float(total_percent), 1),
                "budgets_count": len(budgets),
            },
        }
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible consultar los presupuestos: {exc}") from exc


@app.post("/api/budgets", status_code=status.HTTP_201_CREATED, tags=["Presupuestos"])
def create_budget(payload: BudgetPayload) -> dict[str, Any]:
    """Create a monthly budget for one category."""
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO budgets (category, limit_amount, period_start)
                       VALUES (%s, %s, %s)
                       RETURNING id""",
                    (payload.category, payload.limit_amount, payload.period_start),
                )
                row = cursor.fetchone()
                budget_id = row[0]
        saved = get_budget_row(budget_id)
        if saved is None:
            raise HTTPException(status_code=500, detail="El presupuesto se guardó, pero no pudo recuperarse.")
        return serialize_budget(saved)
    except PsycopgError as exc:
        if getattr(exc, "pgcode", None) == "23505":
            raise HTTPException(
                status_code=409,
                detail="Ya existe un presupuesto para esa categoría y ese mes. Puedes editar el existente.",
            ) from exc
        raise HTTPException(status_code=503, detail=f"No fue posible crear el presupuesto: {exc}") from exc
    except DatabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail=f"Base de datos no disponible: {exc}") from exc


@app.put("/api/budgets/{budget_id}", tags=["Presupuestos"])
def update_budget(budget_id: int, payload: BudgetPayload) -> dict[str, Any]:
    """Update the category, amount or month of a budget."""
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE budgets
                       SET category = %s,
                           limit_amount = %s,
                           period_start = %s,
                           updated_at = NOW()
                       WHERE id = %s
                       RETURNING id""",
                    (payload.category, payload.limit_amount, payload.period_start, budget_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail="Presupuesto no encontrado.")
        saved = get_budget_row(budget_id)
        if saved is None:
            raise HTTPException(status_code=404, detail="Presupuesto no encontrado.")
        return serialize_budget(saved)
    except HTTPException:
        raise
    except PsycopgError as exc:
        if getattr(exc, "pgcode", None) == "23505":
            raise HTTPException(
                status_code=409,
                detail="Ya existe otro presupuesto para esa categoría y ese mes.",
            ) from exc
        raise HTTPException(status_code=503, detail=f"No fue posible actualizar el presupuesto: {exc}") from exc
    except DatabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail=f"Base de datos no disponible: {exc}") from exc


@app.delete(
    "/api/budgets/{budget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Presupuestos"],
)
def delete_budget(budget_id: int) -> Response:
    """Delete one monthly budget without changing any transaction."""
    try:
        row = query_one("DELETE FROM budgets WHERE id = %s RETURNING id", (budget_id,))
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible eliminar el presupuesto: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)






# ---------------------------- Metas de ahorro ----------------------------


def _goal_select_sql() -> str:
    """Return each savings goal with contributions calculated from the ledger."""
    return """
        SELECT
            g.id,
            g.title,
            g.description,
            g.target_amount,
            g.target_date,
            g.created_at,
            g.updated_at,
            COALESCE(SUM(c.amount), 0) AS saved_amount,
            COUNT(c.id) AS contributions_count
        FROM savings_goals AS g
        LEFT JOIN savings_contributions AS c ON c.goal_id = g.id
    """


def serialize_goal(row: dict[str, Any]) -> dict[str, Any]:
    """Calculate savings progress and status without storing derived totals."""
    target = Decimal(str(row["target_amount"]))
    saved = Decimal(str(row.get("saved_amount", 0) or 0))
    remaining = max(target - saved, Decimal("0.00"))
    percent = (saved / target * Decimal("100")) if target > 0 else Decimal("0")
    target_date = row.get("target_date")

    if saved >= target:
        goal_status = "achieved"
    elif target_date and target_date < date.today():
        goal_status = "overdue"
    else:
        goal_status = "in_progress"

    return {
        "id": int(row["id"]),
        "title": row["title"],
        "description": row.get("description") or "",
        "target_amount": float(target),
        "saved_amount": float(saved),
        "remaining_amount": float(remaining),
        "percent_complete": round(float(percent), 1),
        "status": goal_status,
        "target_date": target_date.isoformat() if target_date else None,
        "contributions_count": int(row.get("contributions_count", 0)),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def serialize_contribution(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a savings contribution row to JSON-friendly values."""
    return {
        "id": int(row["id"]),
        "goal_id": int(row["goal_id"]),
        "amount": float(Decimal(str(row["amount"]))),
        "contribution_date": row["contribution_date"].isoformat(),
        "note": row.get("note") or "",
        "created_at": row["created_at"].isoformat(),
    }


def get_goal_row(goal_id: int) -> dict[str, Any] | None:
    """Retrieve a goal with its calculated contribution total."""
    return query_one(_goal_select_sql() + " WHERE g.id = %s GROUP BY g.id", (goal_id,))


def get_goal_or_404(goal_id: int) -> dict[str, Any]:
    """Return a goal row or raise a consistent 404 response."""
    try:
        row = get_goal_row(goal_id)
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail="No fue posible consultar la meta de ahorro.") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Meta de ahorro no encontrada.")
    return row


@app.get("/api/goals", tags=["Metas de ahorro"])
def list_savings_goals() -> dict[str, Any]:
    """List savings goals and calculate overall progress from contribution records."""
    try:
        rows = query_all(
            _goal_select_sql() + " GROUP BY g.id ORDER BY (COALESCE(SUM(c.amount), 0) >= g.target_amount) DESC, g.target_date NULLS LAST, g.created_at DESC"
        )
        goals = [serialize_goal(row) for row in rows]
        total_target = sum((Decimal(str(goal["target_amount"])) for goal in goals), Decimal("0.00"))
        total_saved = sum((Decimal(str(goal["saved_amount"])) for goal in goals), Decimal("0.00"))
        total_remaining = sum((Decimal(str(goal["remaining_amount"])) for goal in goals), Decimal("0.00"))
        completed_count = sum(1 for goal in goals if goal["status"] == "achieved")
        return {
            "goals": goals,
            "summary": {
                "goals_count": len(goals),
                "completed_count": completed_count,
                "active_count": len(goals) - completed_count,
                "total_target": float(total_target),
                "total_saved": float(total_saved),
                "total_remaining": float(total_remaining),
            },
        }
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible consultar las metas de ahorro: {exc}") from exc


@app.post("/api/goals", status_code=status.HTTP_201_CREATED, tags=["Metas de ahorro"])
def create_savings_goal(payload: SavingsGoalPayload) -> dict[str, Any]:
    """Create a savings goal without requiring an initial contribution."""
    try:
        row = query_one(
            """INSERT INTO savings_goals (title, description, target_amount, target_date)
               VALUES (%s, %s, %s, %s)
               RETURNING id""",
            (payload.title, payload.description, payload.target_amount, payload.target_date),
        )
        saved = get_goal_row(int(row["id"]))
        if saved is None:
            raise HTTPException(status_code=500, detail="La meta se guardó, pero no pudo recuperarse.")
        return serialize_goal(saved)
    except HTTPException:
        raise
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible crear la meta: {exc}") from exc


@app.put("/api/goals/{goal_id}", tags=["Metas de ahorro"])
def update_savings_goal(goal_id: int, payload: SavingsGoalPayload) -> dict[str, Any]:
    """Update a goal's description, target amount or target date."""
    try:
        row = query_one(
            """UPDATE savings_goals
               SET title = %s, description = %s, target_amount = %s,
                   target_date = %s, updated_at = NOW()
               WHERE id = %s
               RETURNING id""",
            (payload.title, payload.description, payload.target_amount, payload.target_date, goal_id),
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Meta de ahorro no encontrada.")
        saved = get_goal_row(goal_id)
        if saved is None:
            raise HTTPException(status_code=404, detail="Meta de ahorro no encontrada.")
        return serialize_goal(saved)
    except HTTPException:
        raise
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible actualizar la meta: {exc}") from exc


@app.delete(
    "/api/goals/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Metas de ahorro"],
)
def delete_savings_goal(goal_id: int) -> Response:
    """Delete a goal and its contributions; transactions remain untouched."""
    try:
        row = query_one("DELETE FROM savings_goals WHERE id = %s RETURNING id", (goal_id,))
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible eliminar la meta: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Meta de ahorro no encontrada.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/goals/{goal_id}/contributions", tags=["Metas de ahorro - Aportaciones"])
def list_goal_contributions(goal_id: int) -> list[dict[str, Any]]:
    """Return the contribution history for one goal."""
    get_goal_or_404(goal_id)
    try:
        rows = query_all(
            """SELECT id, goal_id, amount, contribution_date, note, created_at
               FROM savings_contributions
               WHERE goal_id = %s
               ORDER BY contribution_date DESC, id DESC""",
            (goal_id,),
        )
        return [serialize_contribution(row) for row in rows]
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible consultar las aportaciones: {exc}") from exc


@app.post(
    "/api/goals/{goal_id}/contributions",
    status_code=status.HTTP_201_CREATED,
    tags=["Metas de ahorro - Aportaciones"],
)
def create_goal_contribution(goal_id: int, payload: SavingsContributionPayload) -> dict[str, Any]:
    """Record a deposit and return the updated goal progress."""
    get_goal_or_404(goal_id)
    try:
        row = query_one(
            """INSERT INTO savings_contributions (goal_id, amount, contribution_date, note)
               VALUES (%s, %s, %s, %s)
               RETURNING id, goal_id, amount, contribution_date, note, created_at""",
            (goal_id, payload.amount, payload.contribution_date, payload.note),
        )
        goal = get_goal_row(goal_id)
        if goal is None:
            raise HTTPException(status_code=404, detail="Meta de ahorro no encontrada.")
        return {
            "contribution": serialize_contribution(row),
            "goal": serialize_goal(goal),
        }
    except HTTPException:
        raise
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible registrar la aportación: {exc}") from exc


@app.delete(
    "/api/goals/{goal_id}/contributions/{contribution_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Metas de ahorro - Aportaciones"],
)
def delete_goal_contribution(goal_id: int, contribution_id: int) -> Response:
    """Delete one contribution without deleting its savings goal."""
    try:
        row = query_one(
            """DELETE FROM savings_contributions
               WHERE id = %s AND goal_id = %s
               RETURNING id""",
            (contribution_id, goal_id),
        )
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible eliminar la aportación: {exc}") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Aportación no encontrada en esta meta.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------- Logros e insignias ----------------------------

ACHIEVEMENT_CATALOG: list[dict[str, Any]] = [
    {
        "code": "first_step", "title": "Primer paso", "description": "Tu recorrido financiero comienza con una acción.",
        "requirement": "Registra tu primer ingreso o gasto.", "category": "Inicio", "points": 10,
        "symbol": "1", "metric": "transactions_count", "target": 1,
        "progress_detail": "movimiento(s) registrado(s)",
    },
    {
        "code": "small_saver", "title": "Pequeño ahorrador", "description": "Cada aportación te acerca a lo que quieres conseguir.",
        "requirement": "Registra tu primera aportación a una meta de ahorro.", "category": "Ahorro", "points": 20,
        "symbol": "$", "metric": "contributions_count", "target": 1,
        "progress_detail": "aportación(es) registrada(s)",
    },
    {
        "code": "financial_organizer", "title": "Organizador financiero", "description": "Poner límites también es una forma de avanzar.",
        "requirement": "Crea tu primer presupuesto mensual.", "category": "Organización", "points": 10,
        "symbol": "▤", "metric": "budgets_count", "target": 1,
        "progress_detail": "presupuesto(s) registrado(s)",
    },
    {
        "code": "budget_in_order", "title": "Presupuesto en orden", "description": "La constancia se nota cuando respetas tus límites.",
        "requirement": "Cierra un mes completo sin superar ninguno de tus presupuestos.", "category": "Organización", "points": 30,
        "symbol": "✓", "metric": "budget_in_order", "target": 1,
        "progress_detail": "mes(es) cerrado(s) dentro de tus límites",
    },
    {
        "code": "financial_consistency", "title": "Constancia financiera", "description": "Registrar tus movimientos te ayuda a tomar mejores decisiones.",
        "requirement": "Registra 10 movimientos financieros.", "category": "Actividad", "points": 20,
        "symbol": "10", "metric": "transactions_count", "target": 10,
        "progress_detail": "de 10 movimientos",
    },
    {
        "code": "goal_achieved", "title": "Meta alcanzada", "description": "Un objetivo cumplido demuestra lo que puedes lograr con disciplina.",
        "requirement": "Completa el 100% de al menos una meta de ahorro.", "category": "Ahorro", "points": 50,
        "symbol": "★", "metric": "completed_goals_count", "target": 1,
        "progress_detail": "meta(s) completada(s)",
    },
    {
        "code": "disciplined_saver", "title": "Ahorrador disciplinado", "description": "Ahorrar de forma constante convierte pequeñas acciones en grandes avances.",
        "requirement": "Registra cinco aportaciones a tus metas de ahorro.", "category": "Ahorro", "points": 30,
        "symbol": "◆", "metric": "contributions_count", "target": 5,
        "progress_detail": "de 5 aportaciones",
    },
]

LEVELS = [
    {"number": 1, "name": "Principiante", "minimum": 0, "next": 40},
    {"number": 2, "name": "Organizado", "minimum": 40, "next": 80},
    {"number": 3, "name": "Constante", "minimum": 80, "next": 120},
    {"number": 4, "name": "Experto financiero", "minimum": 120, "next": 170},
    {"number": 5, "name": "Maestro StudentWallet", "minimum": 170, "next": None},
]


def _achievement_progress_detail(achievement: dict[str, Any], current: int) -> str:
    code = achievement["code"]
    if code == "budget_in_order":
        return "Ya cerraste un mes dentro de tus límites." if current else "Aún no has cerrado un mes con todos tus presupuestos dentro del límite."
    target = int(achievement["target"])
    if code == "first_step":
        return "Primer movimiento registrado." if current else "Todavía no registras movimientos."
    if code == "small_saver":
        return "Primera aportación registrada." if current else "Registra una aportación para iniciar tu ahorro."
    if code == "financial_organizer":
        return "Primer presupuesto creado." if current else "Crea un presupuesto mensual."
    if code == "goal_achieved":
        return f"{current} meta(s) completada(s)."
    return f"{min(current, target)} de {target} {achievement['progress_detail']}."


def _build_level(points: int) -> dict[str, Any]:
    current = LEVELS[-1]
    for level in LEVELS:
        if points >= level["minimum"]:
            current = level
        else:
            break
    next_level = next((level for level in LEVELS if level["number"] == current["number"] + 1), None)
    if next_level is None:
        progress = 100
        points_to_next = 0
        next_name = None
    else:
        span = next_level["minimum"] - current["minimum"]
        progress = round((points - current["minimum"]) / span * 100) if span else 100
        points_to_next = max(0, next_level["minimum"] - points)
        next_name = next_level["name"]
    return {
        "number": current["number"],
        "name": current["name"],
        "points": points,
        "points_to_next_level": points_to_next,
        "next_level_name": next_name,
        "progress_percent": max(0, min(100, progress)),
    }


def evaluate_achievements() -> dict[str, Any]:
    """Award each eligible achievement once and return the saved collection."""
    try:
        with get_connection() as connection:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """SELECT
                        (SELECT COUNT(*)::int FROM transactions) AS transactions_count,
                        (SELECT COUNT(*)::int FROM budgets) AS budgets_count,
                        (SELECT COUNT(*)::int FROM savings_contributions) AS contributions_count,
                        (SELECT COUNT(*)::int FROM (
                            SELECT g.id
                            FROM savings_goals AS g
                            LEFT JOIN savings_contributions AS c ON c.goal_id = g.id
                            GROUP BY g.id
                            HAVING COALESCE(SUM(c.amount), 0) >= g.target_amount
                        ) AS completed_goals) AS completed_goals_count,
                        EXISTS (
                            SELECT 1
                            FROM (
                                SELECT b.period_start,
                                    BOOL_AND(
                                        b.created_at::date < (b.period_start + INTERVAL '1 month')::date
                                        AND COALESCE((
                                            SELECT SUM(t.amount)
                                            FROM transactions AS t
                                            WHERE t.type = 'expense'
                                              AND t.category = b.category
                                              AND t.date >= b.period_start
                                              AND t.date < (b.period_start + INTERVAL '1 month')::date
                                        ), 0) <= b.limit_amount
                                    ) AS all_within_limit
                                FROM budgets AS b
                                WHERE b.period_start < DATE_TRUNC('month', CURRENT_DATE)::date
                                GROUP BY b.period_start
                            ) AS closed_budget_months
                            WHERE closed_budget_months.all_within_limit
                        ) AS budget_in_order"""
                )
                metric_row = cursor.fetchone()
                metrics = {
                    "transactions_count": int(metric_row["transactions_count"]),
                    "budgets_count": int(metric_row["budgets_count"]),
                    "contributions_count": int(metric_row["contributions_count"]),
                    "completed_goals_count": int(metric_row["completed_goals_count"]),
                    "budget_in_order": 1 if metric_row["budget_in_order"] else 0,
                }

                newly_unlocked_codes: list[str] = []
                for achievement in ACHIEVEMENT_CATALOG:
                    current = metrics[achievement["metric"]]
                    if current < int(achievement["target"]):
                        continue
                    cursor.execute(
                        """INSERT INTO achievement_unlocks (code, points_awarded)
                           VALUES (%s, %s)
                           ON CONFLICT (code) DO NOTHING
                           RETURNING code""",
                        (achievement["code"], achievement["points"]),
                    )
                    if cursor.fetchone():
                        newly_unlocked_codes.append(achievement["code"])

                cursor.execute(
                    "SELECT code, points_awarded, unlocked_at FROM achievement_unlocks ORDER BY unlocked_at ASC, code ASC"
                )
                unlock_rows = cursor.fetchall()
    except (DatabaseConfigurationError, PsycopgError) as exc:
        logger.exception("No fue posible evaluar los logros de StudentWallet.")
        raise HTTPException(status_code=503, detail="No fue posible consultar o guardar los logros.") from exc

    unlock_map = {row["code"]: row for row in unlock_rows}
    points = sum(int(row["points_awarded"]) for row in unlock_rows)
    achievements: list[dict[str, Any]] = []
    for definition in ACHIEVEMENT_CATALOG:
        current = int(metrics[definition["metric"]])
        target = int(definition["target"])
        unlocked_row = unlock_map.get(definition["code"])
        achievements.append({
            "code": definition["code"],
            "title": definition["title"],
            "description": definition["description"],
            "requirement": definition["requirement"],
            "category": definition["category"],
            "points": int(definition["points"]),
            "symbol": definition["symbol"],
            "unlocked": bool(unlocked_row),
            "unlocked_at": unlocked_row["unlocked_at"].isoformat() if unlocked_row else None,
            "progress": {
                "current": min(current, target),
                "target": target,
                "percent": min(100, round(current / target * 100)) if target else 0,
                "detail": _achievement_progress_detail(definition, current),
            },
        })

    newly_unlocked = [
        {"code": definition["code"], "title": definition["title"], "points": int(definition["points"])}
        for definition in ACHIEVEMENT_CATALOG
        if definition["code"] in newly_unlocked_codes
    ]
    return {
        "points": points,
        "unlocked_count": len(unlock_map),
        "total_achievements": len(ACHIEVEMENT_CATALOG),
        "level": _build_level(points),
        "achievements": achievements,
        "newly_unlocked": newly_unlocked,
    }


@app.get("/api/achievements", response_model=AchievementsResponse, tags=["Logros e insignias"])
def list_achievements() -> dict[str, Any]:
    """Evaluate current financial activity, persist newly earned badges and return the collection."""
    return evaluate_achievements()


@app.get("/api/dashboard/summary", tags=["Dashboard"])
def dashboard_summary() -> dict[str, Any]:
    """Return aggregate financial figures calculated by PostgreSQL."""
    try:
        totals = query_one(
            """SELECT
                 COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
                 COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses
               FROM transactions"""
        )
        category_rows = query_all(
            """SELECT category, COALESCE(SUM(amount), 0) AS total
               FROM transactions WHERE type = 'expense'
               GROUP BY category ORDER BY total DESC"""
        )
        income = Decimal(totals["income"])
        expenses = Decimal(totals["expenses"])
        return {
            "income": float(income),
            "expenses": float(expenses),
            "balance": float(income - expenses),
            "expenses_by_category": [
                {"category": item["category"], "total": float(Decimal(item["total"]))}
                for item in category_rows
            ],
        }
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail=f"No fue posible generar el resumen: {exc}") from exc


@app.get("/api/dashboard/period", tags=["Dashboard"])
def dashboard_period(
    period: str = Query(default="month", pattern="^(week|month)$"),
    reference_date: date | None = Query(
        default=None,
        description="Fecha de referencia. Si se omite, se utiliza la fecha actual del servidor.",
    ),
) -> dict[str, Any]:
    """Return weekly or monthly financial totals and expense categories."""
    target_date = reference_date or date.today()
    if period == "week":
        start_date = target_date - timedelta(days=target_date.weekday())
        end_date = start_date + timedelta(days=6)
    else:
        start_date = target_date.replace(day=1)
        if target_date.month == 12:
            next_month = date(target_date.year + 1, 1, 1)
        else:
            next_month = date(target_date.year, target_date.month + 1, 1)
        end_date = next_month - timedelta(days=1)

    try:
        totals = query_one(
            """SELECT
                 COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
                 COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses,
                 COUNT(*) AS transactions_count
               FROM transactions
               WHERE date >= %s AND date <= %s""",
            (start_date, end_date),
        )
        category_rows = query_all(
            """SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS transactions_count
               FROM transactions
               WHERE type = 'expense' AND date >= %s AND date <= %s
               GROUP BY category
               ORDER BY total DESC, category ASC""",
            (start_date, end_date),
        )
        income = Decimal(totals["income"])
        expenses = Decimal(totals["expenses"])
        return {
            "period": period,
            "reference_date": target_date.isoformat(),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "income": float(income),
            "expenses": float(expenses),
            "balance": float(income - expenses),
            "transactions_count": int(totals["transactions_count"]),
            "expenses_by_category": [
                {
                    "category": item["category"],
                    "total": float(Decimal(item["total"])),
                    "transactions_count": int(item["transactions_count"]),
                }
                for item in category_rows
            ],
        }
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No fue posible generar el resumen del periodo: {exc}",
        ) from exc


# ---------------------------- Gemini conversation history ----------------------------


def _get_conversation_or_404(conversation_id: int) -> dict[str, Any]:
    try:
        row = query_one(
            "SELECT id, title, created_at, updated_at FROM chat_conversations WHERE id = %s",
            (conversation_id,),
        )
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail="No fue posible consultar el historial.") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="La conversación no existe.")
    return row


def _load_conversation_history(conversation_id: int, limit: int = 12) -> list[dict[str, str]]:
    """Load the most recent messages in chronological order for Gemini context."""
    rows = query_all(
        """SELECT role, content
           FROM chat_messages
           WHERE conversation_id = %s
           ORDER BY created_at DESC, id DESC
           LIMIT %s""",
        (conversation_id, limit),
    )
    rows.reverse()
    return [{"role": row["role"], "content": row["content"]} for row in rows]


def _save_chat_exchange(
    question: str,
    answer: str,
    model_used: str,
    period: str,
    reference_date: date | None,
    conversation_id: int | None,
) -> dict[str, Any]:
    """Save the user/assistant pair atomically and return conversation metadata."""
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            if conversation_id is None:
                title = " ".join(question.split())[:117]
                if len(" ".join(question.split())) > 117:
                    title = title.rstrip() + "..."
                cursor.execute(
                    """INSERT INTO chat_conversations (title)
                       VALUES (%s)
                       RETURNING id, title, created_at, updated_at""",
                    (title or "Nueva conversación",),
                )
                conversation = cursor.fetchone()
                conversation_id = conversation["id"]
            else:
                cursor.execute(
                    """UPDATE chat_conversations
                       SET updated_at = NOW()
                       WHERE id = %s
                       RETURNING id, title, created_at, updated_at""",
                    (conversation_id,),
                )
                conversation = cursor.fetchone()
                if conversation is None:
                    raise HTTPException(status_code=404, detail="La conversación no existe.")

            cursor.execute(
                """INSERT INTO chat_messages
                   (conversation_id, role, content, model_used, period, reference_date)
                   VALUES (%s, 'user', %s, NULL, %s, %s)""",
                (conversation_id, question, period, reference_date),
            )
            cursor.execute(
                """INSERT INTO chat_messages
                   (conversation_id, role, content, model_used, period, reference_date)
                   VALUES (%s, 'assistant', %s, %s, %s, %s)""",
                (conversation_id, answer, model_used, period, reference_date),
            )
            cursor.execute(
                "UPDATE chat_conversations SET updated_at = NOW() WHERE id = %s",
                (conversation_id,),
            )

    return conversation


@app.get("/api/assistant/conversations", tags=["Gemini AI - Historial"])
def list_chat_conversations() -> list[dict[str, Any]]:
    """List the latest 100 local prototype conversations."""
    try:
        rows = query_all(
            """SELECT c.id, c.title, c.created_at, c.updated_at,
                      COUNT(m.id) AS message_count
               FROM chat_conversations AS c
               LEFT JOIN chat_messages AS m ON m.conversation_id = c.id
               GROUP BY c.id
               ORDER BY c.updated_at DESC, c.id DESC
               LIMIT 100"""
        )
        return [serialize_conversation(row) for row in rows]
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail="No fue posible consultar las conversaciones.") from exc


@app.get("/api/assistant/conversations/{conversation_id}", tags=["Gemini AI - Historial"])
def get_chat_conversation(conversation_id: int) -> dict[str, Any]:
    """Get one conversation and all its messages in chronological order."""
    try:
        row = query_one(
            """SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS message_count
               FROM chat_conversations AS c
               LEFT JOIN chat_messages AS m ON m.conversation_id = c.id
               WHERE c.id = %s
               GROUP BY c.id""",
            (conversation_id,),
        )
        if row is None:
            raise HTTPException(status_code=404, detail="La conversación no existe.")
        messages = query_all(
            """SELECT id, role, content, model_used, period, reference_date, created_at
               FROM chat_messages
               WHERE conversation_id = %s
               ORDER BY created_at ASC, id ASC""",
            (conversation_id,),
        )
        return {
            **serialize_conversation(row),
            "messages": [serialize_chat_message(message) for message in messages],
        }
    except HTTPException:
        raise
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail="No fue posible recuperar la conversación.") from exc


@app.delete(
    "/api/assistant/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["Gemini AI - Historial"],
)
def delete_chat_conversation(conversation_id: int) -> Response:
    """Delete a conversation; PostgreSQL cascades the deletion to its messages."""
    try:
        row = query_one(
            "DELETE FROM chat_conversations WHERE id = %s RETURNING id",
            (conversation_id,),
        )
    except (DatabaseConfigurationError, PsycopgError) as exc:
        raise HTTPException(status_code=503, detail="No fue posible eliminar la conversación.") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="La conversación no existe.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/assistant/chat", tags=["Gemini AI"])
def assistant_chat(payload: AssistantChatRequest) -> dict[str, Any]:
    """Chat with Gemini; create or continue a persisted conversation."""
    try:
        # Validate an existing conversation and load its previous messages.
        conversation_history: list[dict[str, str]] = []
        if payload.conversation_id is not None:
            _get_conversation_or_404(payload.conversation_id)
            conversation_history = _load_conversation_history(payload.conversation_id)

        # Select financial context from PostgreSQL for the requested period.
        if payload.period == "general":
            financial_context = {
                "period": "general",
                "period_label": "Todo el historial registrado",
                **dashboard_summary(),
            }
        else:
            financial_context = dashboard_period(
                period=payload.period,
                reference_date=payload.reference_date,
            )
            financial_context["period_label"] = (
                "Esta semana" if payload.period == "week" else "Este mes"
            )

        # Ask Gemini. The service returns the exact model that generated the answer.
        result = ask_gemini(
            question=payload.question,
            financial_context=financial_context,
            conversation_history=conversation_history,
        )
        answer = result["answer"]
        model_used = result["model_used"]
        effective_reference_date = payload.reference_date
        if payload.period in {"week", "month"} and effective_reference_date is None:
            effective_reference_date = date.today()

        # Save the pair only after Gemini has answered successfully.
        # This avoids creating incomplete conversations when both models fail.
        conversation = _save_chat_exchange(
            question=payload.question,
            answer=answer,
            model_used=model_used,
            period=payload.period,
            reference_date=effective_reference_date,
            conversation_id=payload.conversation_id,
        )

        return {
            "status": "success",
            "assistant": "StudentWallet AI",
            "conversation_id": conversation["id"],
            "conversation_title": conversation["title"],
            "period": payload.period,
            "reference_date": effective_reference_date.isoformat() if effective_reference_date else None,
            "model_used": model_used,
            "answer": answer,
            "financial_context": financial_context,
        }
    except HTTPException:
        raise
    except (DatabaseConfigurationError, PsycopgError) as exc:
        logger.exception("StudentWallet AI: error al guardar o recuperar el historial en PostgreSQL.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No fue posible guardar o recuperar la conversación. Inténtalo nuevamente.",
        ) from exc
    except Exception as exc:
        logger.exception("StudentWallet AI: error al procesar la conversación.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "StudentWallet AI no está disponible temporalmente. "
                "Verifica la conexión con Gemini e inténtalo nuevamente."
            ),
        ) from exc


@app.get("/", include_in_schema=False)
def frontend_home() -> FileResponse:
    """Serve the StudentWallet frontend from the same origin as its API."""
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")
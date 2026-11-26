"""StudentWallet AI service using Gemini with a primary and fallback model."""

import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger("uvicorn.error")
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


def _generate_response(client: genai.Client, model: str, prompt: str) -> str:
    """Generate a response with a given model and reject empty results."""
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.4,
            max_output_tokens=256,
        ),
    )
    answer = (response.text or "").strip()
    if not answer:
        raise RuntimeError(f"Gemini devolvió una respuesta vacía con el modelo {model}.")
    return answer


def ask_gemini(
    question: str,
    financial_context: dict[str, Any],
    conversation_history: list[dict[str, str]] | None = None,
) -> dict[str, str]:
    """Generate concise financial advice and return answer plus actual model."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    primary_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.1-flash-lite").strip()

    if not api_key or api_key == "TU_API_KEY":
        raise RuntimeError("No se encontró una GEMINI_API_KEY válida en el archivo .env.")
    if not primary_model:
        raise RuntimeError("No se configuró GEMINI_MODEL en el archivo .env.")
    if fallback_model == primary_model:
        logger.warning("StudentWallet AI: el modelo de respaldo coincide con el principal; se desactivará.")
        fallback_model = ""

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=45_000,
            retry_options=types.HttpRetryOptions(
                attempts=2,
                initial_delay=1.0,
                max_delay=3.0,
                exp_base=2.0,
                jitter=1.0,
                http_status_codes=sorted(RETRYABLE_STATUS_CODES),
            ),
        ),
    )

    context = json.dumps(financial_context, ensure_ascii=False, indent=2, default=str)

    # Limit the amount of stored context sent to Gemini.
    history_items = (conversation_history or [])[-12:]
    history_lines: list[str] = []
    for item in history_items:
        role = item.get("role", "")
        content = item.get("content", "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        speaker = "Estudiante" if role == "user" else "StudentWallet AI"
        history_lines.append(f"{speaker}: {content[:2500]}")
    history_text = "\n".join(history_lines) if history_lines else "No hay mensajes anteriores."

    prompt = f"""
Eres StudentWallet AI, el asistente financiero inteligente de una aplicación creada especialmente para estudiantes.

PERSONALIDAD:
- Amigable, natural y profesional.
- Habla de forma sencilla y cercana.
- Responde siempre en español.

REGLAS DE RESPUESTA:
1. Responde de forma breve: aproximadamente 60 a 120 palabras.
2. Contesta directamente la pregunta del usuario.
3. Ofrece como máximo tres recomendaciones.
4. Utiliza emojis con moderación.
5. Evita introducciones y explicaciones innecesarias.
6. No repitas información que el usuario ya conoce.
7. No inventes cantidades, movimientos, periodos ni resultados.
8. No inventes fuentes ni atribuyas recomendaciones a expertos sin referencias verificables.

REGLAS FINANCIERAS:
- Utiliza exclusivamente los datos incluidos en el contexto financiero.
- Los ingresos, gastos y balances son calculados por el sistema; no los modifiques.
- Respeta el periodo indicado en el contexto y no lo presentes como otro periodo.
- Si el contexto contiene todo el historial, no afirmes que corresponde al mes actual.
- Distingue el balance registrado del dinero necesariamente disponible para gastar.
- Si falta información, dilo claramente.
- Ofrece orientación financiera general y prudente; no prometas resultados.

HISTORIAL DE ESTA CONVERSACIÓN:
{history_text}

INFORMACIÓN FINANCIERA ACTUAL:
{context}

PREGUNTA ACTUAL DEL USUARIO:
{question.strip()}

Responde de manera breve, útil y personalizada. Utiliza el historial solo para dar continuidad; si contradice los datos financieros actuales, prevalece el contexto financiero actual.
"""

    logger.info("StudentWallet AI: intentando modelo principal '%s'.", primary_model)
    try:
        answer = _generate_response(client, primary_model, prompt)
        logger.info("StudentWallet AI: respuesta generada correctamente con el modelo principal '%s'.", primary_model)
        return {"answer": answer, "model_used": primary_model}

    except errors.APIError as primary_error:
        status_code = getattr(primary_error, "code", None)
        if status_code not in RETRYABLE_STATUS_CODES or not fallback_model:
            logger.exception(
                "StudentWallet AI: falló el modelo principal '%s' con HTTP %s; no se utilizará el respaldo.",
                primary_model,
                status_code,
            )
            raise RuntimeError(
                "StudentWallet AI no está disponible temporalmente. Inténtalo de nuevo en unos momentos."
            ) from primary_error

        logger.warning(
            "StudentWallet AI: el modelo principal '%s' falló con HTTP %s. Se intentará '%s'.",
            primary_model,
            status_code,
            fallback_model,
        )
        logger.info("StudentWallet AI: intentando modelo de respaldo '%s'.", fallback_model)

        try:
            answer = _generate_response(client, fallback_model, prompt)
        except Exception as fallback_error:
            logger.exception("StudentWallet AI: también falló el modelo de respaldo '%s'.", fallback_model)
            raise RuntimeError(
                "StudentWallet AI no está disponible temporalmente. Inténtalo de nuevo en unos momentos."
            ) from fallback_error

        logger.info("StudentWallet AI: respuesta generada correctamente con el modelo de respaldo '%s'.", fallback_model)
        return {"answer": answer, "model_used": fallback_model}

    except Exception as exc:
        logger.exception("StudentWallet AI: error inesperado al consultar el modelo principal '%s'.", primary_model)
        raise RuntimeError(
            "StudentWallet AI no está disponible temporalmente. Inténtalo de nuevo en unos momentos."
        ) from exc

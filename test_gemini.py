import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai

# Cargar las variables del archivo .env
load_dotenv(Path(__file__).parent / ".env")

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

if not API_KEY or API_KEY == "TU_API_KEY":
    raise RuntimeError("No se encontró la API Key de Gemini.")

# Crear cliente de Gemini
client = genai.Client(api_key=API_KEY)

# Primera petición
response = client.models.generate_content(
    model=MODEL,
    contents="Hola, eres StudentWallet AI. Preséntate brevemente en español."
)

print(response.text)

print("\n========== STUDENTWALLET AI ==========\n")

print(response.text)

print("\n======================================")
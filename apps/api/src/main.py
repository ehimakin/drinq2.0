from fastapi import FastAPI
from src.mobile.games.trivia.pintless.api import router as pintless_router

app = FastAPI(title="Drinq API")
app.include_router(pintless_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

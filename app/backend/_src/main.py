from fastapi import FastAPI
from pydantic import BaseModel
from mobile.games.trivia.pintless.api import router as pintless_router


app = FastAPI()

app.include_router(pintless_router)

class InitRequest(BaseModel):
    username: str
    mode: str

class StartRequest(BaseModel):
    session_id: str
    category: str

@app.post("/mobile/games/trivia/pintless/init")
def init_pintless_game(data: InitRequest):
    return init_game_session(data.username, data.mode)

@app.post("/mobile/games/trivia/pintless/start")
def start_pintless_game(data: StartRequest):
    return start_game_with_category(data.session_id, data.category)

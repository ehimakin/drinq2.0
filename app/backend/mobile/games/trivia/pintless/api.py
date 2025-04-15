from fastapi import APIRouter
from pydantic import BaseModel
from fastapi import HTTPException
from ._src.engine import init_game_session, start_game_with_category, submit_answer

router = APIRouter()

class InitRequest(BaseModel):
    username: str
    mode: str

class StartRequest(BaseModel):
    session_id: str
    category: str

class SubmitRequest(BaseModel):
    session_id: str
    question_id: int
    answer: str

@router.post("/games/pintless/init")
def init_pintless_game(data: InitRequest):
    return init_game_session(data.username, data.mode)

@router.post("/games/pintless/start")
def start_pintless_game(data: StartRequest):
    return start_game_with_category(data.session_id, data.category)

@router.post("/games/pintless/submit")
def submit_pintless_answer(data: SubmitRequest):
    result = submit_answer(data.session_id, data.question_id, data.answer)
    if result is None:
        raise HTTPException(status_code=404, detail="Invalid session or question.")
    return result

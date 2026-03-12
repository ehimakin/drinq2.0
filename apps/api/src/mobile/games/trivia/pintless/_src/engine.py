import uuid
from uuid import uuid4
from .questions import get_question, list_categories, get_question_by_id
# In-memory session cache (temp storage)
SESSIONS = {}

def init_game_session(username: str, mode: str):
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "username": username,
        "mode": mode,
        "category": None
    }
    return {
        "session_id": session_id,
        "available_categories": list_categories()
    }

def start_game_with_category(session_id: str, category: str):
    if session_id not in SESSIONS:
        return {"error": "Invalid session"}

    SESSIONS[session_id]["category"] = category
    question = get_question(category)
    return {
        "question": question
    }


def submit_answer(session_id: str, question_id: int, answer: str):
    session = SESSIONS.get(session_id)
    if not session:
        return None

    # Simulate answer checking (just lowercase match)
    question = get_question_by_id(question_id)
    if not question:
        return None

    correct = question["answer"].lower() == answer.lower()
    score = 1 if correct else 0

    # You can track score here per session if desired
    session.setdefault("score", 0)
    session["score"] += score

    next_q = get_question(session["category"], skip_id=question_id)

    return {
        "correct": correct,
        "score": session["score"],
        "next_question": next_q
    }
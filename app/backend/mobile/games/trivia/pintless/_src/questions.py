# Simulated question DB
QUESTIONS_DB = {
    "general_knowledge": [
        {"id": 1, "question": "Name a common cocktail ingredient.", "answer": "lime", "type": "text"},
        {"id": 2, "question": "What is the main ingredient in a margarita?", "answer": "tequila", "type": "text"},
    ],
    "music": [
        {"id": 3, "question": "Name a song with 'love' in the title.", "answer": "What's Love?", "type": "text"}
    ]
}

def get_question(category: str, skip_id: int = None):
    for q in QUESTIONS_DB.get(category, []):
        if q["id"] != skip_id:
            return q
    return None

def list_categories():
    return list(QUESTIONS_DB.keys())

def get_question_by_id(qid: int):
    for cat in QUESTIONS_DB.values():
        for q in cat:
            if q["id"] == qid:
                return q
    return None


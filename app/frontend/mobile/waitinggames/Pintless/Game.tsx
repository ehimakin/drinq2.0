import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';

const Game = () => {
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState('single'); // Hardcoded for now
  const [sessionId, setSessionId] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [question, setQuestion] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const API = 'http://192.168.0.13:8000/games/pintless'; // Adjust if using device

  const initGame = async () => {
    const res = await fetch(`${API}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, mode }),
    });
    const data = await res.json();
    setSessionId(data.session_id);
    setCategories(data.available_categories);
  };

  const startGame = async (cat: string) => {
    setCategory(cat);
    const res = await fetch(`${API}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, category: cat }),
    });
    const data = await res.json();
    setQuestion(data.question);
    setStatus(null);
    setAnswer('');
  };

  const submitAnswer = async () => {
    const res = await fetch(`${API}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: question.id,
        answer,
      }),
    });
    const data = await res.json();
    setScore(data.score);
    setStatus(data.correct ? 'Correct!' : 'Wrong!');
    setQuestion(data.next_question);
    setAnswer('');
  };

  return (
    <View style={{ padding: 20 }}>
      {!sessionId ? (
        <>
          <Text>Enter Name:</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            style={{ borderWidth: 1, marginBottom: 10 }}
          />
          <Button title="Start Game" onPress={initGame} />
        </>
      ) : !question ? (
        <>
          <Text>Select Category:</Text>
          {categories.map((cat) => (
            <Button key={cat} title={cat} onPress={() => startGame(cat)} />
          ))}
        </>
      ) : (
        <>
          <Text>Category: {category}</Text>
          <Text>Score: {score}</Text>
          <Text style={{ marginTop: 20 }}>{question.question}</Text>
          <TextInput
            value={answer}
            onChangeText={setAnswer}
            style={{ borderWidth: 1, marginVertical: 10 }}
          />
          <Button title="Submit Answer" onPress={submitAnswer} />
          {status && <Text style={{ marginTop: 10 }}>{status}</Text>}
        </>
      )}
    </View>
  );
};

export default Game;

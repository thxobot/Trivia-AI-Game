import React, { useState } from 'react';
import { TriviaConfig } from '../types';

interface SetupScreenProps {
  onStart: (config: TriviaConfig) => void;
  isLoading: boolean;
}

const PERSONALITIES = [
  { id: 'enthusiastic', name: 'Enthusiastic Host', desc: 'High energy, super encouraging!' },
  { id: 'sarcastic', name: 'Sarcastic Robot', desc: 'Dry wit, mild roasting included.' },
  { id: 'dramatic', name: 'Dramatic Narrator', desc: 'Treats every question like a movie trailer.' },
  { id: 'professor', name: 'Strict Professor', desc: 'Demands precision, offers detailed facts.' },
];

const SetupScreen: React.FC<SetupScreenProps> = ({ onStart, isLoading }) => {
  const [topic, setTopic] = useState('Space Exploration');
  const [personality, setPersonality] = useState(PERSONALITIES[0].id);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic && personality) {
      onStart({ topic, personality });
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-slate-800/50 rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-xl">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/20 mb-4">
          <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">TrivAI Live</h1>
        <p className="text-slate-400">Voice-powered trivia with Gemini 2.5</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Choose a Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-white placeholder-slate-500 transition-all"
            placeholder="e.g. 90s Pop Music, Quantum Physics..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Host Personality</label>
          <div className="grid grid-cols-1 gap-3">
            {PERSONALITIES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonality(p.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  personality === p.id
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                    : 'bg-slate-900/50 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <div className="font-semibold">{p.name}</div>
                <div className={`text-xs ${personality === p.id ? 'text-indigo-200' : 'text-slate-500'}`}>
                  {p.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
            isLoading
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Preparing Game...
            </span>
          ) : (
            'Start Live Game'
          )}
        </button>
      </form>
      
      <div className="mt-6 text-xs text-center text-slate-500">
        <p>Powered by Gemini Live API & Google Search</p>
      </div>
    </div>
  );
};

export default SetupScreen;
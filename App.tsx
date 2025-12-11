import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, TriviaConfig, GeneratedQuestion } from './types';
import SetupScreen from './components/SetupScreen';
import AudioVisualizer from './components/AudioVisualizer';
import { generateQuestions, generateSummarySpeech } from './services/geminiService';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from './services/audioUtils';

// Initialize GenAI outside component
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App: React.FC = () => {
  const [phase, setPhase] = useState<GamePhase>(GamePhase.SETUP);
  const [config, setConfig] = useState<TriviaConfig | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null); // To store the session object (simplified)
  
  // Game Logic State
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState<{role: 'user'|'model', text: string}[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endSession();
    };
  }, []);

  const endSession = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (sessionRef.current && typeof sessionRef.current.close === 'function') {
      try { sessionRef.current.close(); } catch(e) {}
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    setIsConnected(false);
  };

  const handleStart = async (newConfig: TriviaConfig) => {
    setConfig(newConfig);
    setPhase(GamePhase.PREPARING);
    setError(null);

    try {
      // 1. Generate Questions using Search Grounding
      const { questions: generatedQuestions, sources: groundingSources } = await generateQuestions(newConfig.topic);
      setQuestions(generatedQuestions);
      setSources(groundingSources);

      // 2. Prepare System Prompt with these questions
      setPhase(GamePhase.READY);
    } catch (e) {
      console.error(e);
      setError("Failed to generate questions. Please try again.");
      setPhase(GamePhase.SETUP);
    }
  };

  const startLiveSession = async () => {
    if (!config || questions.length === 0) return;
    
    setPhase(GamePhase.PLAYING);
    
    // Initialize Audio Contexts
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    audioContextRef.current = outputCtx; // Store main output context

    // Input Analyser
    const inputAnalyser = inputCtx.createAnalyser();
    inputAnalyser.fftSize = 256;
    inputAnalyserRef.current = inputAnalyser;

    // Output Analyser
    const outputAnalyser = outputCtx.createAnalyser();
    outputAnalyser.fftSize = 256;
    outputAnalyserRef.current = outputAnalyser;
    
    // Connect output analyser to destination
    // Note: We will connect sources to this analyser, then to destination
    // But we need to make sure we don't break the chain.
    // Simpler: Connect sources -> outputAnalyser -> destination.

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup Input Stream
      const source = inputCtx.createMediaStreamSource(stream);
      source.connect(inputAnalyser); // For viz
      
      const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
      
      // Construct System Instruction
      const questionsText = questions.map((q, i) => 
        `Q${i+1}: ${q.question} (Answer: ${q.answer}) [Fact: ${q.context}]`
      ).join('\n');

      const systemInstruction = `
        You are a trivia host with this personality: ${config.personality}.
        Your goal is to run a trivia game with the user about "${config.topic}".
        
        Here are the questions you MUST ask, one by one. Do not skip any.
        ${questionsText}
        
        Rules:
        1. Greet the user and explain the topic briefly.
        2. Ask the first question.
        3. Wait for the user's answer.
        4. If correct, congratulate them enthusiastically. If wrong, gently correct them and share the [Fact].
        5. Move to the next question immediately after the feedback.
        6. After the last question (Q5), summarize how they did and say "GAME OVER".
        
        Keep responses concise and spoken-word friendly. Be lively!
      `;

      // Connect to Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            setIsConnected(true);
            
            // Connect Audio Processing
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             // Handle Transcript
             if (message.serverContent?.modelTurn?.parts?.[0]?.text) {
                setTranscript(prev => [...prev, { role: 'model', text: message.serverContent?.modelTurn?.parts?.[0]?.text || ''}]);
             }
             
             // Handle Audio Output
             const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (base64Audio) {
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
               
               const audioBuffer = await decodeAudioData(
                 base64ToUint8Array(base64Audio),
                 outputCtx,
                 24000,
                 1
               );

               const sourceNode = outputCtx.createBufferSource();
               sourceNode.buffer = audioBuffer;
               
               // Connect to analyser for viz, then destination
               sourceNode.connect(outputAnalyser); 
               outputAnalyser.connect(outputCtx.destination);

               sourceNode.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               
               sourcesRef.current.add(sourceNode);
               sourceNode.onended = () => sourcesRef.current.delete(sourceNode);
             }

             // Handle Interruptions
             if (message.serverContent?.interrupted) {
               sourcesRef.current.forEach(s => s.stop());
               sourcesRef.current.clear();
               nextStartTimeRef.current = 0;
             }
             
             // Check for "Game Over" trigger in text to end game gracefully? 
             // Hard to detect in pure audio, but if we had transcription enabled we could.
             // For now, rely on user to click "End Game".
          },
          onclose: () => {
            console.log("Session Closed");
            setIsConnected(false);
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setError("Connection error.");
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          systemInstruction: systemInstruction,
        }
      });
      
      // Store session for later closing if needed (though promise-based)
      // sessionRef.current = ... (Not directly accessible sync, but handled via closure/promise)
      
    } catch (e) {
      console.error("Failed to start live session", e);
      setError("Microphone access denied or API error.");
      setPhase(GamePhase.SETUP);
    }
  };

  const handleEndGame = async () => {
    endSession();
    setPhase(GamePhase.ENDED);
    // Auto-play a summary using TTS
    if (questions.length > 0) {
        const summaryText = `That was a great game of ${config?.topic} trivia! I hope you learned something new. Thanks for playing TrivAI Live.`;
        const buffer = await generateSummarySpeech(summaryText);
        if (buffer && audioContextRef.current) {
            // Re-use context or create new if closed (likely closed by endSession)
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start();
        }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-slate-900 z-[-1]"></div>
      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2 pointer-events-none"></div>

      {phase === GamePhase.SETUP && (
        <SetupScreen onStart={handleStart} isLoading={false} />
      )}
      
      {phase === GamePhase.PREPARING && (
         <SetupScreen onStart={handleStart} isLoading={true} />
      )}

      {phase === GamePhase.READY && (
        <div className="text-center max-w-lg w-full bg-slate-800/80 p-8 rounded-2xl backdrop-blur-md border border-slate-700 shadow-2xl animate-fade-in">
          <h2 className="text-3xl font-bold text-white mb-4">Trivia Ready!</h2>
          <p className="text-slate-300 mb-6">
            We have 5 fresh questions about <span className="text-indigo-400 font-bold">{config?.topic}</span>.
            <br/><br/>
            Turn up your volume and click "Connect" to meet your host.
          </p>
          
          <div className="mb-6 flex flex-wrap gap-2 justify-center">
            {sources.length > 0 && (
              <div className="text-xs text-slate-500 w-full mb-1">Verified with Google Search:</div>
            )}
            {sources.map((source, idx) => (
               source.web?.uri ? (
                  <a key={idx} href={source.web.uri} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300 truncate max-w-[150px]">
                    {source.web.title || "Source"}
                  </a>
               ) : null
            ))}
          </div>

          <button 
            onClick={startLiveSession}
            className="w-full py-4 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-green-900/50 transition-all"
          >
            Connect to Live Host
          </button>
        </div>
      )}

      {phase === GamePhase.PLAYING && (
        <div className="w-full max-w-2xl flex flex-col items-center gap-8 animate-fade-in">
           <div className="w-full bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-md relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-400 to-emerald-600 animate-pulse"></div>
             
             <div className="flex justify-between items-center mb-8">
               <div className="flex items-center gap-3">
                 <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                 <span className="text-slate-300 font-mono text-sm">{isConnected ? 'LIVE CONNECTION' : 'CONNECTING...'}</span>
               </div>
               <div className="text-indigo-400 font-bold text-sm uppercase tracking-wider">{config?.personality}</div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-2">
                   <label className="text-xs text-slate-500 uppercase font-bold tracking-wider">AI Voice Output</label>
                   <AudioVisualizer analyser={outputAnalyserRef.current} isActive={isConnected} color="#a78bfa" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs text-slate-500 uppercase font-bold tracking-wider">Your Microphone</label>
                   <AudioVisualizer analyser={inputAnalyserRef.current} isActive={isConnected} color="#34d399" />
                </div>
             </div>

             <div className="text-center text-slate-400 text-sm italic">
               Listening... Speak clearly to answer.
             </div>
           </div>

           <button 
             onClick={handleEndGame}
             className="px-8 py-3 bg-red-500/10 border border-red-500/50 text-red-400 hover:bg-red-500/20 rounded-full transition-all font-medium text-sm"
           >
             End Session
           </button>
        </div>
      )}

      {phase === GamePhase.ENDED && (
        <div className="text-center bg-slate-800/90 p-8 rounded-2xl border border-slate-700 backdrop-blur-xl animate-scale-in">
          <h2 className="text-4xl font-bold text-white mb-2">Game Over</h2>
          <p className="text-slate-300 mb-8">Thanks for playing!</p>
          <button 
            onClick={() => setPhase(GamePhase.SETUP)}
            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all shadow-lg"
          >
            Play Again
          </button>
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-xl backdrop-blur-md">
          {error}
        </div>
      )}
    </div>
  );
};

export default App;
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { GeneratedQuestion } from "../types";
import { base64ToUint8Array, decodeAudioData } from "./audioUtils";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// 1. Generate Questions using Search Grounding
export const generateQuestions = async (topic: string): Promise<{ questions: GeneratedQuestion[], sources: any[] }> => {
  const prompt = `
    Generate 5 engaging trivia questions about "${topic}".
    Use Google Search to find interesting, accurate, and potentially recent facts.
    
    Return the output strictly as a JSON block formatted like this:
    \`\`\`json
    [
      {
        "question": "The question text",
        "answer": "The correct answer",
        "context": "A short fun fact explaining the answer"
      }
    ]
    \`\`\`
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      // Note: responseMimeType: 'application/json' is not supported with googleSearch in all regions/versions yet,
      // but we requested JSON in the prompt.
    },
  });

  // Extract grounding metadata
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

  // Parse JSON from text
  const text = response.text || "";
  let questions: GeneratedQuestion[] = [];
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      questions = JSON.parse(jsonMatch[1]);
    } else {
      // Fallback: try parsing the whole text if no code blocks
      questions = JSON.parse(text);
    }
  } catch (e) {
    console.error("Failed to parse trivia questions JSON", e);
    // Fallback question if parsing fails
    questions = [{
      question: `I couldn't auto-generate specific questions about ${topic}, but let's play anyway! What is the main thing you know about ${topic}?`,
      answer: "N/A",
      context: "Sometimes even AI has a hiccup!"
    }];
  }

  return { questions, sources };
};

// 2. Generate Speech (TTS) for Game Summary
export const generateSummarySpeech = async (text: string): Promise<AudioBuffer | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const audioBuffer = await decodeAudioData(
      base64ToUint8Array(base64Audio),
      outputAudioContext,
      24000,
      1
    );
    return audioBuffer;

  } catch (e) {
    console.error("TTS generation failed", e);
    return null;
  }
};
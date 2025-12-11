export enum GamePhase {
  SETUP = 'SETUP',
  PREPARING = 'PREPARING',
  READY = 'READY',
  PLAYING = 'PLAYING',
  ENDED = 'ENDED'
}

export interface TriviaConfig {
  topic: string;
  personality: string;
}

export interface GeneratedQuestion {
  question: string;
  answer: string;
  context: string;
}

export interface AudioVisualizerState {
  volume: number;
}
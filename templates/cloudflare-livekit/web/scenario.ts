import data from '../agent/src/scenario.json';
export const scenario = data.scenario;
export const scenarioData = data;
export interface ConversationControls {
  speak(text: string): Promise<void>;
  interrupt(): Promise<void>;
  setMode(mode: string): Promise<void>;
}

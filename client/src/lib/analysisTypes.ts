export interface TextChunk {
  id: string;
  text: string;
  wordCount: number;
  title: string;
  preview: string;
  selected: boolean;
}

export type AnalysisMode = 
  | "cognitive-short"
  | "cognitive-long" 
  | "psychological-short"
  | "psychological-long"
  | "psychopathological-short"
  | "psychopathological-long";

export type LLMProvider = "zhi1" | "zhi2" | "zhi3" | "zhi4";

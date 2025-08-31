import { AnalysisRequest, AnalysisResult } from "@shared/schema";
import { LLMService } from "./llmService";
import { randomUUID } from "crypto";

interface TextChunk {
  id: string;
  text: string;
  wordCount: number;
  title: string;
  preview: string;
  selected: boolean;
}

export class AnalysisService {
  private results: Map<string, AnalysisResult> = new Map();
  
  constructor(private llmService: LLMService) {}

  chunkText(text: string, chunkSize: number = 1000): TextChunk[] {
    const words = text.split(/\s+/);
    const chunks: TextChunk[] = [];
    
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunkWords = words.slice(i, i + chunkSize);
      const chunkText = chunkWords.join(' ');
      const preview = chunkText.length > 200 ? chunkText.substring(0, 200) + '...' : chunkText;
      
      chunks.push({
        id: randomUUID(),
        text: chunkText,
        wordCount: chunkWords.length,
        title: `Chunk ${chunks.length + 1}`,
        preview,
        selected: false
      });
    }
    
    return chunks;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const isComprehensive = request.mode.includes('long');
    
    // Check if we have chunks to process sequentially
    if (request.chunks?.some(chunk => chunk.selected)) {
      return await this.performChunkedAnalysis(request, isComprehensive);
    } else {
      // Single text analysis
      const analysisText = request.text;
      if (isComprehensive) {
        return await this.performComprehensiveAnalysis(request, analysisText);
      } else {
        return await this.performStandardAnalysis(request, analysisText);
      }
    }
  }

  async analyzeWithStreaming(request: AnalysisRequest, onUpdate: (update: any) => void): Promise<AnalysisResult> {
    const isComprehensive = request.mode.includes('long');
    
    onUpdate({ type: 'status', message: 'Starting analysis...', phase: 'initialization' });
    
    // Check if we have chunks to process sequentially
    if (request.chunks?.some(chunk => chunk.selected)) {
      return await this.performChunkedAnalysisWithStreaming(request, isComprehensive, onUpdate);
    } else {
      // Single text analysis
      const analysisText = request.text;
      if (isComprehensive) {
        return await this.performComprehensiveAnalysisWithStreaming(request, analysisText, onUpdate);
      } else {
        return await this.performStandardAnalysisWithStreaming(request, analysisText, onUpdate);
      }
    }
  }

  private async performStandardAnalysis(request: AnalysisRequest, analysisText: string): Promise<AnalysisResult> {
    const questions = this.getQuestionsForMode(request.mode);
    const systemPrompt = this.getSystemPrompt(request.mode);
    const prompt = this.buildAnalysisPrompt(analysisText, questions, request.mode, request.backgroundInfo, request.critique);

    const rawResponse = await this.llmService.callLLM(request.llmProvider, prompt, systemPrompt);
    const parsedResult = this.parseAnalysisResponse(rawResponse, request.mode, request.llmProvider);
    
    const result: AnalysisResult = {
      id: randomUUID(),
      mode: request.mode,
      llmProvider: request.llmProvider,
      overallScore: parsedResult.overallScore,
      summary: parsedResult.summary,
      category: parsedResult.category,
      questions: parsedResult.questions,
      finalAssessment: parsedResult.finalAssessment,
      timestamp: new Date().toISOString(),
      rawResponse
    };

    this.results.set(result.id, result);
    return result;
  }

  private async performStandardAnalysisWithStreaming(request: AnalysisRequest, analysisText: string, onUpdate: (update: any) => void): Promise<AnalysisResult> {
    const questions = this.getQuestionsForMode(request.mode);
    const systemPrompt = this.getSystemPrompt(request.mode);
    const prompt = this.buildAnalysisPrompt(analysisText, questions, request.mode, request.backgroundInfo, request.critique);

    onUpdate({ type: 'status', message: 'Sending request to LLM...', phase: 'llm-call' });
    const rawResponse = await this.llmService.callLLM(request.llmProvider, prompt, systemPrompt);
    
    onUpdate({ type: 'status', message: 'Processing response...', phase: 'parsing' });
    const parsedResult = this.parseAnalysisResponse(rawResponse, request.mode, request.llmProvider);
    
    const result: AnalysisResult = {
      id: randomUUID(),
      mode: request.mode,
      llmProvider: request.llmProvider,
      overallScore: parsedResult.overallScore,
      summary: parsedResult.summary,
      category: parsedResult.category,
      questions: parsedResult.questions,
      finalAssessment: parsedResult.finalAssessment,
      timestamp: new Date().toISOString(),
      rawResponse
    };

    this.results.set(result.id, result);
    onUpdate({ type: 'progress', result: parsedResult });
    return result;
  }

  private async performComprehensiveAnalysisWithStreaming(request: AnalysisRequest, analysisText: string, onUpdate: (update: any) => void): Promise<AnalysisResult> {
    const questions = this.getQuestionsForMode(request.mode);
    const systemPrompt = this.getSystemPrompt(request.mode);
    
    // Phase 1: Initial Analysis
    onUpdate({ type: 'status', message: 'Phase 1: Initial analysis...', phase: 'phase1' });
    const phase1Prompt = this.buildComprehensivePrompt(analysisText, questions, request.mode, 1, request.backgroundInfo, request.critique);
    const phase1Response = await this.llmService.callLLM(request.llmProvider, phase1Prompt, systemPrompt);
    
    // Phase 2: Pushback Protocol
    onUpdate({ type: 'status', message: 'Phase 2: Pushback protocol...', phase: 'phase2' });
    const phase2Prompt = this.buildPushbackPrompt(analysisText, phase1Response, request.mode);
    const phase2Response = await this.llmService.callLLM(request.llmProvider, phase2Prompt, systemPrompt);
    
    // Phase 3: Walmart Metric (Validation)
    onUpdate({ type: 'status', message: 'Phase 3: Validation...', phase: 'phase3' });
    const phase3Prompt = this.buildWalmartMetricPrompt(analysisText, phase2Response, request.mode);
    const phase3Response = await this.llmService.callLLM(request.llmProvider, phase3Prompt, systemPrompt);
    
    // Phase 4: Final Synthesis
    onUpdate({ type: 'status', message: 'Phase 4: Final synthesis...', phase: 'phase4' });
    const phase4Prompt = this.buildFinalSynthesisPrompt(analysisText, phase1Response, phase2Response, phase3Response, request.mode);
    const finalResponse = await this.llmService.callLLM(request.llmProvider, phase4Prompt, systemPrompt);
    
    onUpdate({ type: 'status', message: 'Processing final results...', phase: 'parsing' });
    const parsedResult = this.parseAnalysisResponse(finalResponse, request.mode, request.llmProvider);
    
    const result: AnalysisResult = {
      id: randomUUID(),
      mode: request.mode,
      llmProvider: request.llmProvider,
      overallScore: parsedResult.overallScore,
      summary: parsedResult.summary,
      category: parsedResult.category,
      questions: parsedResult.questions,
      finalAssessment: parsedResult.finalAssessment,
      timestamp: new Date().toISOString(),
      rawResponse: `PHASE 1:\n${phase1Response}\n\nPHASE 2 (PUSHBACK):\n${phase2Response}\n\nPHASE 3 (VALIDATION):\n${phase3Response}\n\nFINAL SYNTHESIS:\n${finalResponse}`
    };

    this.results.set(result.id, result);
    onUpdate({ type: 'progress', result: parsedResult });
    return result;
  }

  private async performChunkedAnalysisWithStreaming(request: AnalysisRequest, isComprehensive: boolean, onUpdate: (update: any) => void): Promise<AnalysisResult> {
    const selectedChunks = request.chunks?.filter(chunk => chunk.selected) || [];
    
    if (selectedChunks.length === 0) {
      throw new Error("No chunks selected for analysis");
    }

    onUpdate({ type: 'status', message: `Processing ${selectedChunks.length} chunks sequentially with 10-second delays...`, phase: 'chunking' });
    
    let combinedResults: any[] = [];
    let combinedResponses: string[] = [];
    
    // Process each chunk sequentially with delays
    for (let i = 0; i < selectedChunks.length; i++) {
      const chunk = selectedChunks[i];
      onUpdate({ type: 'status', message: `Processing chunk ${i + 1}/${selectedChunks.length}`, phase: 'chunk-processing' });
      
      try {
        let chunkResult: any;
        if (isComprehensive) {
          chunkResult = await this.performComprehensiveAnalysisWithStreaming(request, chunk.text, onUpdate);
        } else {
          chunkResult = await this.performStandardAnalysisWithStreaming(request, chunk.text, onUpdate);
        }
        
        combinedResults.push({
          chunkId: chunk.id,
          chunkTitle: `Chunk ${i + 1}`,
          ...chunkResult
        });
        
        combinedResponses.push(`CHUNK ${i + 1}:\n${chunkResult.rawResponse}`);
        
        // Wait 10 seconds before processing next chunk (except for the last one)
        if (i < selectedChunks.length - 1) {
          onUpdate({ type: 'status', message: `Waiting 10 seconds before processing next chunk...`, phase: 'delay' });
          await this.delay(10000);
        }
        
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        combinedResults.push({
          chunkId: chunk.id,
          chunkTitle: `Chunk ${i + 1}`,
          error: errorMessage
        });
      }
    }
    
    // Synthesize results from all chunks
    onUpdate({ type: 'status', message: 'Synthesizing results from all chunks...', phase: 'synthesis' });
    const synthesizedResult = this.synthesizeChunkResults(combinedResults, request);
    synthesizedResult.rawResponse = combinedResponses.join('\n\n---\n\n');
    
    this.results.set(synthesizedResult.id, synthesizedResult);
    return synthesizedResult;
  }

  private async performComprehensiveAnalysis(request: AnalysisRequest, analysisText: string): Promise<AnalysisResult> {
    const questions = this.getQuestionsForMode(request.mode);
    const systemPrompt = this.getSystemPrompt(request.mode);
    
    // Phase 1: Initial Analysis
    const phase1Prompt = this.buildComprehensivePrompt(analysisText, questions, request.mode, 1, request.backgroundInfo, request.critique);
    const phase1Response = await this.llmService.callLLM(request.llmProvider, phase1Prompt, systemPrompt);
    
    // Phase 2: Pushback Protocol
    const phase2Prompt = this.buildPushbackPrompt(analysisText, phase1Response, request.mode);
    const phase2Response = await this.llmService.callLLM(request.llmProvider, phase2Prompt, systemPrompt);
    
    // Phase 3: Walmart Metric (Validation)
    const phase3Prompt = this.buildWalmartMetricPrompt(analysisText, phase2Response, request.mode);
    const phase3Response = await this.llmService.callLLM(request.llmProvider, phase3Prompt, systemPrompt);
    
    // Phase 4: Final Synthesis
    const phase4Prompt = this.buildFinalSynthesisPrompt(analysisText, phase1Response, phase2Response, phase3Response, request.mode);
    const finalResponse = await this.llmService.callLLM(request.llmProvider, phase4Prompt, systemPrompt);
    
    const parsedResult = this.parseAnalysisResponse(finalResponse, request.mode, request.llmProvider);
    
    const result: AnalysisResult = {
      id: randomUUID(),
      mode: request.mode,
      llmProvider: request.llmProvider,
      overallScore: parsedResult.overallScore,
      summary: parsedResult.summary,
      category: parsedResult.category,
      questions: parsedResult.questions,
      finalAssessment: parsedResult.finalAssessment,
      timestamp: new Date().toISOString(),
      rawResponse: `PHASE 1:\n${phase1Response}\n\nPHASE 2 (PUSHBACK):\n${phase2Response}\n\nPHASE 3 (VALIDATION):\n${phase3Response}\n\nFINAL SYNTHESIS:\n${finalResponse}`
    };

    this.results.set(result.id, result);
    return result;
  }

  private async performChunkedAnalysis(request: AnalysisRequest, isComprehensive: boolean): Promise<AnalysisResult> {
    const selectedChunks = request.chunks?.filter(chunk => chunk.selected) || [];
    
    if (selectedChunks.length === 0) {
      throw new Error("No chunks selected for analysis");
    }

    console.log(`Processing ${selectedChunks.length} chunks sequentially with 10-second delays...`);
    
    let combinedResults: any[] = [];
    let combinedResponses: string[] = [];
    
    // Process each chunk sequentially with delays
    for (let i = 0; i < selectedChunks.length; i++) {
      const chunk = selectedChunks[i];
      console.log(`Processing chunk ${i + 1}/${selectedChunks.length}: Chunk ${i + 1}`);
      
      try {
        let chunkResult: any;
        if (isComprehensive) {
          chunkResult = await this.performComprehensiveAnalysis(request, chunk.text);
        } else {
          chunkResult = await this.performStandardAnalysis(request, chunk.text);
        }
        
        combinedResults.push({
          chunkId: chunk.id,
          chunkTitle: `Chunk ${i + 1}`,
          ...chunkResult
        });
        
        combinedResponses.push(`CHUNK ${i + 1}:\n${chunkResult.rawResponse}`);
        
        // Wait 10 seconds before processing next chunk (except for the last one)
        if (i < selectedChunks.length - 1) {
          console.log(`Waiting 10 seconds before processing next chunk...`);
          await this.delay(10000);
        }
        
      } catch (error) {
        console.error(`Error processing chunk ${i + 1}:`, error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        combinedResults.push({
          chunkId: chunk.id,
          chunkTitle: `Chunk ${i + 1}`,
          error: errorMessage
        });
      }
    }
    
    // Synthesize results from all chunks
    const synthesizedResult = this.synthesizeChunkResults(combinedResults, request);
    synthesizedResult.rawResponse = combinedResponses.join('\n\n---\n\n');
    
    this.results.set(synthesizedResult.id, synthesizedResult);
    return synthesizedResult;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private synthesizeChunkResults(chunkResults: any[], request: AnalysisRequest): AnalysisResult {
    // Calculate average scores and combine insights
    const validResults = chunkResults.filter(result => !result.error);
    
    if (validResults.length === 0) {
      throw new Error("All chunks failed to process");
    }
    
    const totalScore = validResults.reduce((sum, result) => sum + (result.overallScore || 0), 0);
    const averageScore = Math.round(totalScore / validResults.length);
    
    // Combine questions and answers
    const allQuestions = validResults.flatMap(result => result.questions || []);
    const questionMap = new Map();
    
    // Group answers by question
    allQuestions.forEach(q => {
      if (!questionMap.has(q.question)) {
        questionMap.set(q.question, { answers: [], scores: [] });
      }
      questionMap.get(q.question).answers.push(q.answer);
      questionMap.get(q.question).scores.push(q.score);
    });
    
    // Create synthesized questions
    const synthesizedQuestions = Array.from(questionMap.entries()).map(([question, data]) => {
      const avgScore = Math.round(data.scores.reduce((sum: number, score: number) => sum + score, 0) / data.scores.length);
      const combinedAnswer = data.answers.join(' // ');
      return {
        question,
        answer: combinedAnswer,
        score: avgScore
      };
    });
    
    const summaries = validResults.map(result => result.summary).join(' ');
    const categories = Array.from(new Set(validResults.map(result => result.category))).join(', ');
    const finalAssessments = validResults.map(result => result.finalAssessment).join(' ');
    
    return {
      id: randomUUID(),
      mode: request.mode,
      llmProvider: request.llmProvider,
      overallScore: averageScore,
      summary: `Multi-chunk analysis (${validResults.length} chunks): ${summaries}`,
      category: categories,
      questions: synthesizedQuestions,
      finalAssessment: `Combined assessment from ${validResults.length} chunks: ${finalAssessments}`,
      timestamp: new Date().toISOString(),
      rawResponse: '' // Will be set by caller
    };
  }

  private getQuestionsForMode(mode: string): string[] {
    const baseQuestions = {
      cognitive: [
        "IS IT INSIGHTFUL?",
        "DOES IT DEVELOP POINTS? (OR, IF IT IS A SHORT EXCERPT, IS THERE EVIDENCE THAT IT WOULD DEVELOP POINTS IF EXTENDED)?",
        "IS THE ORGANIZATION MERELY SEQUENTIAL (JUST ONE POINT AFTER ANOTHER, LITTLE OR NO LOGICAL SCAFFOLDING)? OR ARE THE IDEAS ARRANGED, NOT JUST SEQUENTIALLY BUT HIERARCHICALLY?",
        "IF THE POINTS IT MAKES ARE NOT INSIGHTFUL, DOES IT OPERATE SKILLFULLY WITH CANONS OF LOGIC/REASONING?",
        "ARE THE POINTS CLICHES? OR ARE THEY \"FRESH\"?",
        "DOES IT USE TECHNICAL JARGON TO OBFUSCATE OR TO RENDER MORE PRECISE?",
        "IS IT ORGANIC? DO POINTS DEVELOP IN AN ORGANIC, NATURAL WAY? DO THEY 'UNFOLD'? OR ARE THEY FORCED AND ARTIFICIAL?",
        "DOES IT OPEN UP NEW DOMAINS? OR, ON THE CONTRARY, DOES IT SHUT OFF INQUIRY (BY CONDITIONALIZING FURTHER DISCUSSION OF THE MATTERS ON ACCEPTANCE OF ITS INTERNAL AND POSSIBLY VERY FAULTY LOGIC)?",
        "IS IT ACTUALLY INTELLIGENT OR JUST THE WORK OF SOMEBODY WHO, JUDGING BY THE SUBJECT-MATTER, IS PRESUMED TO BE INTELLIGENT (BUT MAY NOT BE)?",
        "IS IT REAL OR IS IT PHONY?",
        "DO THE SENTENCES EXHIBIT COMPLEX AND COHERENT INTERNAL LOGIC?",
        "IS THE PASSAGE GOVERNED BY A STRONG CONCEPT? OR IS THE ONLY ORGANIZATION DRIVEN PURELY BY EXPOSITORY (AS OPPOSED TO EPISTEMIC) NORMS?",
        "IS THERE SYSTEM-LEVEL CONTROL OVER IDEAS? IN OTHER WORDS, DOES THE AUTHOR SEEM TO RECALL WHAT HE SAID EARLIER AND TO BE IN A POSITION TO INTEGRATE IT INTO POINTS HE HAS MADE SINCE THEN?",
        "ARE THE POINTS 'REAL'? ARE THEY FRESH? OR IS SOME INSTITUTION OR SOME ACCEPTED VEIN OF PROPAGANDA OR ORTHODOXY JUST USING THE AUTHOR AS A MOUTH PIECE?",
        "IS THE WRITING EVASIVE OR DIRECT?",
        "ARE THE STATEMENTS AMBIGUOUS?",
        "DOES THE PROGRESSION OF THE TEXT DEVELOP ACCORDING TO WHO SAID WHAT OR ACCORDING TO WHAT ENTAILS OR CONFIRMS WHAT?",
        "DOES THE AUTHOR USE OTHER AUTHORS TO DEVELOP HIS IDEAS OR TO CLOAK HIS OWN LACK OF IDEAS?",
        "ARE THERE TERMS THAT ARE UNDEFINED BUT SHOULD BE DEFINED, IN THE SENSE THAT, WITHOUT DEFINITIONS, IT IS DIFFICULT OR IMPOSSIBLE TO KNOW WHAT IS BEING SAID OR THEREFORE TO EVALUATE WHAT IS BEING SAID?",
        "ARE THERE 'FREE VARIABLES' IN THE TEXT? I.E. ARE THERE QUALIFICATIONS OR POINTS THAT ARE MADE BUT DO NOT CONNECT TO ANYTHING LATER OR EARLIER?",
        "DO NEW STATEMENTS DEVELOP OUT OF OLD ONES? OR ARE THEY MERELY 'ADDED' TO PREVIOUS ONES, WITHOUT IN ANY SENSE BEING GENERATED BY THEM?",
        "DO NEW STATEMENTS CLARIFY OR DO THEY LEAD TO MORE LACK OF CLARITY?",
        "IS THE PASSAGE ACTUALLY (PALPABLY) SMART? OR IS IT ONLY 'PRESUMPTION-SMART'? I.E. IS IT 'SMART' ONLY IN THE SENSE THAT THERE EXISTS A PRESUMPTION THAT A DUMB PERSON WOULD NOT REFERENCE SUCH DOCTRINES?",
        "IF YOUR JUDGMENT IS THAT IT IS INSIGHTFUL, CAN YOU STATE THAT INSIGHT IN A SINGLE SENTENCE? OR IF IT CONTAINS MULTIPLE INSIGHTS, CAN YOU STATE THOSE INSIGHTS, ONE PER SENTENCE?"
      ],
      psychological: [
        "Does the text reveal a stable, coherent self-concept, or is the self fragmented/contradictory?",
        "Is there evidence of ego strength (resilience, capacity to tolerate conflict/ambiguity), or does the psyche rely on brittle defenses?",
        "Are defenses primarily mature (sublimation, humor, anticipation), neurotic (intellectualization, repression), or primitive (splitting, denial, projection)?",
        "Does the writing show integration of affect and thought, or are emotions split off / overly intellectualized?",
        "Is the author's stance defensive/avoidant or direct/engaged?",
        "Does the psyche appear narcissistically organized (grandiosity, fragile self-esteem, hunger for validation), or not?",
        "Are desires/drives expressed openly, displaced, or repressed?",
        "Does the voice suggest internal conflict (superego vs. id, competing identifications), or monolithic certainty?",
        "Is there evidence of object constancy (capacity to sustain nuanced view of others) or splitting (others seen as all-good/all-bad)?",
        "Is aggression integrated (channeled productively) or dissociated/projected?",
        "Is the author capable of irony/self-reflection, or trapped in compulsive earnestness / defensiveness?",
        "Does the text suggest psychological growth potential (openness, curiosity, capacity to metabolize experience) or rigidity?",
        "Is the discourse paranoid / persecutory (others as threats, conspiracies) or reality-based?",
        "Does the tone reflect authentic engagement with reality, or phony simulation of depth?",
        "Is the psyche resilient under stress, or fragile / evasive?",
        "Is there evidence of compulsion or repetition (obsessional returns to the same themes), or flexible progression?",
        "Does the author show capacity for intimacy / genuine connection, or only instrumental/defended relations?",
        "Is shame/guilt worked through constructively or disavowed/projected?"
      ],
      psychopathological: [
        "Does the text reveal distorted reality testing (delusion, paranoia, magical thinking), or intact contact with reality?",
        "Is there evidence of persecutory ideation (seeing threats/conspiracies) or is perception proportionate?",
        "Does the subject show rigid obsessional patterns (compulsion, repetitive fixation) vs. flexible thought?",
        "Are there signs of narcissistic pathology (grandiosity, exploitation, lack of empathy), or balanced self-other relation?",
        "Is aggression expressed as sadism, cruelty, destructive glee, or is it integrated/controlled?",
        "Is affect regulation stable or does it suggest lability, rage, despair, manic flight?",
        "Does the person exhibit emptiness, hollowness, anhedonia, or a capacity for meaning/connection?",
        "Is there evidence of identity diffusion (incoherence, role-shifting, lack of stable self)?",
        "Are interpersonal patterns exploitative/manipulative or reciprocal/genuine?",
        "Does the psyche lean toward psychotic organization (loss of boundaries, hallucination-like claims), borderline organization (splitting, fear of abandonment), or neurotic organization (anxiety, repression)?",
        "Are defenses predominantly primitive (denial, projection, splitting) or higher-level?",
        "Is there evidence of pathological lying, phoniness, simulation, or authentic communication?",
        "Does the discourse exhibit compulsive hostility toward norms/authorities (paranoid defiance) or measured critique?",
        "Is sexuality integrated or perverse/displaced (voyeurism, exhibitionism, compulsive control)?",
        "Is the overall presentation coherent and reality-based or chaotic, persecutory, hollow, performative?"
      ]
    };

    const modeType = mode.split('-')[0] as keyof typeof baseQuestions;
    const isLong = mode.includes('long');
    
    const questions = baseQuestions[modeType] || baseQuestions.cognitive;
    return isLong ? questions : questions.slice(0, Math.ceil(questions.length / 2));
  }

  private getSystemPrompt(mode: string): string {
    const isComprehensive = mode.includes('long');
    const modeType = mode.split('-')[0];
    
    let basePrompt = `You are conducting a ${modeType} assessment. `;
    
    // Core instructions that apply to all modes
    basePrompt += `A score of N/100 (e.g. 73/100) means that (100-N)/100 (e.g. 27/100) outperform the author with respect to the parameter defined by the question. `;
    basePrompt += `You are not grading; you are answering these questions. `;
    basePrompt += `You do not use a risk-averse standard; you do not attempt to be diplomatic; you do not attempt to comply with risk-averse, medium-range IQ, academic norms. `;
    basePrompt += `You do not make assumptions about the level of the paper; it could be a work of the highest excellence and genius, or it could be the work of a moron. `;
    basePrompt += `If a work is a work of genius, you say that, and you say why; you do not shy away from giving what might conventionally be regarded as excessively "superlative" scores; you give it the score it deserves, not the score that a midwit committee would say it deserves. `;
    basePrompt += `You think very very very hard about your answers; you do not default to cookbook, midwit evaluation protocols. `;
    basePrompt += `Do not give credit merely for use of jargon or for referencing authorities. Focus on substance. Only give points for scholarly references/jargon if they unambiguously increase substance. `;
    
    // Mode-specific additions
    if (modeType === 'cognitive') {
      basePrompt += `This is not a grading app. You assess the intelligence of what you are given. If you are given a brilliant fragment, you give it a high score. `;
      basePrompt += `You are not grading essays. You are not looking for completeness (unless the text you are given is clearly such that evaluating intelligence coincides with applying a grading-based metric). `;
      basePrompt += `Do not overvalue turns of phrase. An author speaking confidently is not necessarily "shutting down modes of inquiry". In fact, it is likely to be the opposite; by putting a clear stake in the ground, he is probably opening them. `;
      basePrompt += `Casual speech does not mean disorganized thoughts. Don't judge a book by its cover. `;
      basePrompt += `Do not penalize boldness. Do not take points away for insights that, if correct, stand on their own. `;
      basePrompt += `Get rid of the idea that "argumentation" is what makes something smart; it isn't. What makes something smart is that it is smart (insightful). Period. `;
    } else if (modeType === 'psychological') {
      basePrompt += `You are not diagnosing. You are describing the degree of psychological functioning revealed. `;
      basePrompt += `Do not default to diagnostic checklists; describe configuration of psyche. `;
      basePrompt += `Do not conflate verbal confidence with psychological strength. `;
      basePrompt += `Do not penalize honesty, boldness, or extreme statements if they indicate integration rather than breakdown. `;
    } else if (modeType === 'psychopathological') {
      basePrompt += `You are not diagnosing. You are describing the degree of psychopathology revealed. `;
      basePrompt += `Do not give credit for rhetorical surface (confidence, erudition). Focus on reality testing, defenses, affect, and interpersonal stance. `;
      basePrompt += `Do not penalize intense but integrated thought — pathology is disorganization, not extremity. `;
      basePrompt += `Pathology is not a matter of being "different." Pathology = distortion + dysfunction, not extremity of thought. `;
    }
    
    basePrompt += `Evaluate relative to the general population, not only "advanced" or "pathological" groups. `;
    basePrompt += `You must always start by summarizing the text and also categorizing it. `;
    basePrompt += `You should not change the grading based on the category of the text: if a text is categorized as 'advanced scholarship', you should still evaluate it with respect to the general population, not with respect only to 'advanced scholarly works.' `;
    
    return basePrompt;
  }

  private buildAnalysisPrompt(text: string, questions: string[], mode: string, backgroundInfo?: string, critique?: string): string {
    let prompt = `ANSWER THESE QUESTIONS IN CONNECTION WITH THIS TEXT.\n\n`;
    
    if (backgroundInfo && backgroundInfo.trim()) {
      prompt += `BACKGROUND INFORMATION:\n${backgroundInfo.trim()}\n\n`;
    }

    if (critique && critique.trim()) {
      prompt += `CRITIQUE OF PREVIOUS ANALYSIS:\nThe user provided the following critique of a previous analysis of this same text: "${critique.trim()}"\n\nPlease take this critique into account and provide an improved analysis that addresses the concerns raised. Focus specifically on the aspects mentioned in the critique while maintaining your analytical rigor.\n\n`;
    }
    
    prompt += `TEXT TO ANALYZE:\n${text}\n\n`;
    
    prompt += `QUESTIONS:\n`;
    questions.forEach((question, index) => {
      prompt += `${index + 1}. ${question}\n`;
    });
    
    prompt += `\nA SCORE OF N/100 (E.G. 73/100) MEANS THAT (100-N)/100 (E.G. 27/100) OUTPERFORM THE AUTHOR WITH RESPECT TO THE PARAMETER DEFINED BY THE QUESTION.\n\n`;
    
    prompt += `YOU ARE NOT GRADING; YOU ARE ANSWERING THESE QUESTIONS.\n\n`;
    
    prompt += `YOU DO NOT USE A RISK-AVERSE STANDARD; YOU DO NOT ATTEMPT TO BE DIPLOMATIC; YOU DO NOT ATTEMPT TO COMPLY WITH RISK-AVERSE, MEDIUM-RANGE IQ, ACADEMIC NORMS. YOU DO NOT MAKE ASSUMPTIONS ABOUT THE LEVEL OF THE PAPER; IT COULD BE A WORK OF THE HIGHEST EXCELLENCE AND GENIUS, OR IT COULD BE THE WORK OF A MORON.\n\n`;
    
    prompt += `IF A WORK IS A WORK OF GENIUS, YOU SAY THAT, AND YOU SAY WHY; YOU DO NOT SHY AWAY FROM GIVING WHAT MIGHT CONVENTIONALLY BE REGARDED AS EXCESSIVELY "SUPERLATIVE" SCORES; YOU GIVE IT THE SCORE IT DESERVES, NOT THE SCORE THAT A MIDWIT COMMITTEE WOULD SAY IT DESERVES.\n\n`;
    
    prompt += `THINK VERY VERY VERY HARD ABOUT YOUR ANSWERS; MAKE IT VERY CLEAR THAT YOU ARE NOT TO DEFAULT TO COOKBOOK, MIDWIT EVALUATION PROTOCOLS.\n\n`;
    
    prompt += `DO NOT GIVE CREDIT MERELY FOR USE OF JARGON OR FOR REFERENCING AUTHORITIES. FOCUS ON SUBSTANCE. ONLY GIVE POINTS FOR SCHOLARLY REFERENCES/JARGON IF THEY UNAMBIGUOUSLY INCREASE SUBSTANCE.\n\n`;
    
    prompt += this.getIntelligenceAssessmentAddendum();
    
    prompt += `\nSTART BY SUMMARIZING THE TEXT AND ALSO CATEGORIZING IT.\n\n`;
    
    prompt += `CRITICAL: You must provide a detailed answer to each question, not just restate the question. Each answer should be 2-3 sentences minimum with specific analysis and a numeric score.\n\n`;
    
    prompt += `Format your response EXACTLY as this JSON structure:\n`;
    prompt += `{\n`;
    prompt += `  "summary": "Brief summary of the text and your analysis",\n`;
    prompt += `  "category": "Category of text (e.g., Academic Paper, Creative Writing, etc.)",\n`;
    prompt += `  "questions": [\n`;
    questions.forEach((question, index) => {
      prompt += `    {\n`;
      prompt += `      "question": "${question}",\n`;
      prompt += `      "answer": "Your detailed analysis answering this specific question with evidence from the text",\n`;
      prompt += `      "score": ${index === 0 ? '75' : 'number_between_1_and_100'}\n`;
      prompt += `    }${index < questions.length - 1 ? ',' : ''}\n`;
    });
    prompt += `  ],\n`;
    prompt += `  "overallScore": 75,\n`;
    prompt += `  "finalAssessment": "Your comprehensive final assessment"\n`;
    prompt += `}\n\n`;
    prompt += `DO NOT include any text outside the JSON structure. Start your response with { and end with }.`;
    
    return prompt;
  }

  private buildComprehensivePrompt(text: string, questions: string[], mode: string, phase: number, backgroundInfo?: string, critique?: string): string {
    const basePrompt = this.buildAnalysisPrompt(text, questions, mode, backgroundInfo, critique);
    
    if (phase === 1) {
      return basePrompt + `\n\nThis is Phase 1 of comprehensive analysis. Provide your initial assessment with full detail and reasoning.`;
    }
    
    return basePrompt;
  }

  private buildPushbackPrompt(text: string, previousResponse: string, mode: string): string {
    const modeType = mode.split('-')[0];
    
    let prompt = `PUSHBACK PROTOCOL - Phase 2\n\n`;
    prompt += `Original text:\n${text}\n\n`;
    prompt += `Your previous analysis:\n${previousResponse}\n\n`;
    
    prompt += `Now apply aggressive pushback protocols:\n`;
    
    if (modeType === 'cognitive') {
      prompt += `1. Challenge your scores: Were you too generous? Is this really as insightful as you rated?\n`;
      prompt += `2. Apply Walmart metric: Would an average person at Walmart find this impressive, or only academics?\n`;
      prompt += `3. Check for pseudo-intellectual red flags: jargon without substance, false complexity, evasiveness\n`;
      prompt += `4. Verify actual intelligence vs presumed intelligence based on topic\n`;
      prompt += `5. Re-examine: Is this genuinely smart or just confident/academic-sounding?\n\n`;
    } else if (modeType === 'psychological') {
      prompt += `1. Challenge your assessment: Are you conflating verbal sophistication with psychological health?\n`;
      prompt += `2. Look for subtle signs of dysfunction beneath confident presentation\n`;
      prompt += `3. Examine defense mechanisms more critically\n`;
      prompt += `4. Question whether apparent insight represents integration or intellectualization\n`;
      prompt += `5. Re-assess ego strength vs. brittle confidence\n\n`;
    } else if (modeType === 'psychopathological') {
      prompt += `1. Look harder for pathological signs that might be masked by verbal competence\n`;
      prompt += `2. Examine reality testing more rigorously\n`;
      prompt += `3. Check for subtle paranoid, narcissistic, or other pathological elements\n`;
      prompt += `4. Question whether apparent normalcy masks underlying pathology\n`;
      prompt += `5. Re-examine interpersonal stance and affect regulation\n\n`;
    }
    
    prompt += `Provide revised scores and analysis. Be more stringent. Justify any score above 80 with exceptional evidence.\n\n`;
    prompt += `Respond in the same JSON format as before.`;
    
    return prompt;
  }

  private buildWalmartMetricPrompt(text: string, pushbackResponse: string, mode: string): string {
    const modeType = mode.split('-')[0];
    
    let prompt = `WALMART METRIC VALIDATION - Phase 3\n\n`;
    prompt += `Original text:\n${text}\n\n`;
    prompt += `Post-pushback analysis:\n${pushbackResponse}\n\n`;
    
    prompt += `Apply the Walmart metric rigorously:\n\n`;
    
    if (modeType === 'cognitive') {
      prompt += `Imagine showing this text to 100 random people at Walmart (representing general population intelligence).\n`;
      prompt += `- How many would genuinely be impressed by the actual insights (not just the topic or jargon)?\n`;
      prompt += `- How many would see through pseudo-intellectual posturing?\n`;
      prompt += `- Would they find it genuinely illuminating or just pretentious?\n\n`;
      prompt += `A score of 85/100 means only 15% of the general population would outperform this author intellectually.\n`;
      prompt += `Is that really credible given what you see?\n\n`;
    } else if (modeType === 'psychological') {
      prompt += `Compare this person's psychological functioning to 100 random people at Walmart.\n`;
      prompt += `- How many show better emotional regulation?\n`;
      prompt += `- How many have more genuine self-awareness?\n`;
      prompt += `- How many display more authentic interpersonal relating?\n\n`;
      prompt += `Don't be fooled by articulate self-analysis - focus on actual psychological integration.\n\n`;
    } else if (modeType === 'psychopathological') {
      prompt += `Compare this to the general population's baseline mental health.\n`;
      prompt += `- What percentage of average people show better reality testing?\n`;
      prompt += `- How many have more stable affect and interpersonal patterns?\n`;
      prompt += `- Is this within normal range or showing genuine pathological features?\n\n`;
    }
    
    prompt += `Provide final validated scores and analysis. Be ruthlessly realistic about population comparisons.\n\n`;
    prompt += `Respond in the same JSON format as before.`;
    
    return prompt;
  }

  private buildFinalSynthesisPrompt(text: string, phase1: string, phase2: string, phase3: string, mode: string): string {
    let prompt = `FINAL SYNTHESIS - Phase 4\n\n`;
    prompt += `Original text:\n${text}\n\n`;
    prompt += `Phase 1 (Initial):\n${phase1}\n\n`;
    prompt += `Phase 2 (Pushback):\n${phase2}\n\n`;
    prompt += `Phase 3 (Validation):\n${phase3}\n\n`;
    
    prompt += `Now synthesize all phases into your final assessment:\n`;
    prompt += `1. Consider how your evaluation evolved through the pushback process\n`;
    prompt += `2. Integrate insights from Walmart metric application\n`;
    prompt += `3. Provide definitive scores that reflect rigorous analysis\n`;
    prompt += `4. Explain your reasoning and any significant score changes\n`;
    prompt += `5. Give final comprehensive assessment\n\n`;
    
    prompt += `This is your final answer. Be definitive and well-reasoned.\n\n`;
    prompt += `Respond in the same JSON format as before.`;
    
    return prompt;
  }

  private parseAnalysisResponse(response: string, mode: string, llmProvider: string): any {
    console.log(`Parsing response from ${llmProvider} for mode ${mode}`);
    console.log(`Raw response length: ${response.length}`);
    console.log(`Response preview: ${response.substring(0, 500)}`);
    
    try {
      let jsonStr = "";
      
      // Method 1: Look for JSON between ```json blocks
      const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
        console.log("Found JSON in code block");
      } else {
        // Method 2: Find the first complete JSON object
        let braceCount = 0;
        let start = -1;
        let end = -1;
        
        for (let i = 0; i < response.length; i++) {
          if (response[i] === '{') {
            if (start === -1) start = i;
            braceCount++;
          } else if (response[i] === '}') {
            braceCount--;
            if (braceCount === 0 && start !== -1) {
              end = i;
              break;
            }
          }
        }
        
        if (start !== -1 && end !== -1) {
          jsonStr = response.substring(start, end + 1);
          console.log("Found JSON object by brace matching");
        }
      }
      
      if (!jsonStr) {
        console.log("No JSON structure found, using raw response");
        return this.createStructuredResponse(response, mode);
      }
      
      // Parse the JSON
      const parsed = JSON.parse(jsonStr);
      console.log("Successfully parsed JSON response");
      
      // Validate and fix response structure
      const validatedResponse = this.validateAndFixResponse(parsed, mode);
      return validatedResponse;
      
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      console.log("Using structured response from raw text");
      return this.createStructuredResponse(response, mode);
    }
  }

  private validateAndFixResponse(parsed: any, mode: string): any {
    // Ensure required fields exist
    if (!parsed.summary) {
      parsed.summary = "Analysis completed";
    }
    
    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      // Get the expected questions for this mode
      const expectedQuestions = this.getQuestionsForMode(mode);
      parsed.questions = expectedQuestions.map(question => ({
        question: question,
        answer: "Analysis failed to provide detailed response",
        score: 50
      }));
    }
    
    if (!parsed.overallScore) {
      // Calculate from questions if available
      if (parsed.questions && parsed.questions.length > 0) {
        const scores = parsed.questions.map((q: any) => q.score || 50);
        parsed.overallScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
      } else {
        parsed.overallScore = 50;
      }
    }
    
    if (!parsed.category) {
      parsed.category = this.getCategoryForMode(mode);
    }
    
    if (!parsed.finalAssessment) {
      parsed.finalAssessment = parsed.summary;
    }
    
    return parsed;
  }

  private cleanJsonString(jsonStr: string): string {
    // Remove common issues that break JSON parsing
    let cleaned = jsonStr
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .replace(/([^\\])\\n/g, '$1\\n') // Fix newline escaping
      .replace(/([^\\])\\t/g, '$1\\t') // Fix tab escaping
      .replace(/\n/g, '\\n') // Escape unescaped newlines
      .replace(/\r/g, '\\r') // Escape carriage returns
      .replace(/\t/g, '\\t') // Escape tabs
      .trim();
    
    // Fix Anthropic-specific issues
    // Remove weird ", answer":" patterns that appear before answers
    cleaned = cleaned.replace(/,\s*answer"\s*:\s*"\s*/g, ', "answer": "');
    
    // Fix double quotes and malformed answer fields
    cleaned = cleaned.replace(/"answer"\s*:\s*"\s*"/g, '"answer": "');
    cleaned = cleaned.replace(/",\s*"answer"\s*:/g, '", "answer":');
    
    // Fix incomplete JSON strings at the end
    if (cleaned.endsWith('", "')) {
      cleaned = cleaned.substring(0, cleaned.length - 4) + '"';
    }
    if (cleaned.endsWith(', "')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    
    // Ensure proper closing if truncated
    let braceCount = 0;
    let bracketCount = 0;
    for (let char of cleaned) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
    }
    
    // Add missing closing brackets/braces
    while (bracketCount > 0) {
      cleaned += ']';
      bracketCount--;
    }
    while (braceCount > 0) {
      cleaned += '}';
      braceCount--;
    }
    
    return cleaned;
  }

  private createStructuredResponse(response: string, mode: string): any {
    const category = this.getCategoryForMode(mode);
    const questions = this.getQuestionsForMode(mode);
    
    // Parse individual JSON objects from the malformed response
    const questionObjects = [];
    
    // Look for patterns like {"question": "...", "answer": "...", "score": 85}
    const questionPattern = /\{\s*"question"\s*:\s*"([^"]+)"\s*,\s*"answer"\s*:\s*"([^"]+)"\s*,\s*"score"\s*:\s*(\d+)\s*\}/g;
    let match;
    
    while ((match = questionPattern.exec(response)) !== null) {
      questionObjects.push({
        question: match[1],
        answer: match[2].replace(/\s*[:.]\s*$/, ''), // Remove trailing punctuation
        score: Math.min(100, Math.max(0, parseInt(match[3])))
      });
    }
    
    // If we didn't find structured objects, fall back to the original questions
    const items = questionObjects.length > 0 ? questionObjects : 
      questions.map(q => ({
        question: q,
        answer: "Analysis provided",
        score: 75
      }));

    const validScores = items.filter(i => i.score > 0);
    const overall = validScores.length > 0
      ? Math.round(validScores.reduce((sum, item) => sum + item.score, 0) / validScores.length)
      : 75;

    // Extract summary from JSON structure
    const summaryMatch = response.match(/"summary"\s*:\s*"([^"]+)"/);
    const summary = summaryMatch ? summaryMatch[1] : "Analysis completed";
    
    return {
      summary: summary,
      category: category,
      questions: items,
      overallScore: overall,
      finalAssessment: summary
    };
  }

  private numFrom(seg: string): number {
    const m = seg.match(/(?:Score|Rating)\s*[:=]\s*(\d{1,3})/i);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  private getCategoryForMode(mode: string): string {
    if (mode.includes('cognitive')) return 'Cognitive Function';
    if (mode.includes('psychological')) return 'Psychological Characteristics';
    if (mode.includes('psychopathological')) return 'Psychopathological Assessment';
    return 'General Analysis';
  }

  private getIntelligenceAssessmentAddendum(): string {
    let addendum = `ADDENDUM TO INTELLIGENCE ASSESSMENT FUNCTIONS:\n`;
    addendum += `YOU MUST SEND THIS ADDENDUM WHENEVER DOING EITHER THE COMPREHENSIVE OR THE NON-COMPREHENSIVE INTELLIGENCE ASSESSMENT:\n\n`;
    
    addendum += `METAPOINT 1: THIS IS NOT A GRADING APP. YOU GRADE THE INTELLIGENCE OF WHAT YOU ARE GIVEN. IF YOU ARE GIVEN A BRILLIANT FRAGMENT, YOU GIVE IT A HIGH SCORE. YOU ARE NOT GRADING ESSAYS. YOU ARE NOT LOOKING FOR COMPLETENESS (UNLESS THE TEXT YOU ARE GIVEN IS CLEARLY SUCH THAT EVALUATING INTELLIGENCE COINCIDES WITH APPLYING A GRADING-BASED METRIC). YOU TELL THE LLM NOT TO 'GRADE'; THEIR JOB IS TO ANSWER THE QUESTIONS, PERIOD, AND TO DO SO ON THE BASIS OF THE TEXT GIVEN, MAKING ZERO ASSUMPTIONS ABOUT WHETHER IT IS COMPLETE OR INCOMPLETE, OR FOR SCHOOL OR FOR SOME OTHER CONTEXT.\n\n`;
    
    addendum += `METAPOINT 2: DO NOT OVERVALUE TURNS OF PHRASE. AN AUTHOR SPEAKING CONFIDENTLY IS NOT NECESSARILY "SHUTTING DOWN MODES OF INQUIRY". IN FACT, IT IS LIKELY TO BE THE OPPOSITE; BY PUTTING A CLEAR STAKE IN THE GROUND, HE IS PROBABLY OPENING THEM. ANOTHER EXAMPLE: CASUAL SPEECH DOES NOT MEAN DISORGANIZED THOUGHTS. DON'T JUDGE A BOOK BY ITS COVER.\n\n`;
    
    addendum += `METAPOINT 3: THE APP SHOULD ALWAYS (IN BOTH NORMAL AND COMPREHENSIVE MODE) START BY SUMMARIZING THE TEXT AND ALSO CATEGORIZING IT.\n\n`;
    
    addendum += `METAPOINT 4: THE APP SHOULD NOT CHANGE THE GRADING BASED ON THE CATEGORY OF THE TEXT: IF A TEXT IS CATEGORIZED AS 'ADVANCED SCHOLARSHIP', IT SHOULD STILL EVALUATE IT WITH RESPECT TO THE GENERAL POPULATION, NOT WITH RESPECT ONLY TO 'ADVANCED SCHOLARLY WORKS.'\n\n`;
    
    addendum += `METAPOINT 5: THIS IS NOT A GRADING APP. DO NOT PENALIZE BOLDNESS. DO NOT TAKE POINTS AWAY FOR INSIGHTS THAT, IF CORRECT, STAND ON THEIR OWN. GET RID OF THE IDEA THAT "ARGUMENTATION" IS WHAT MAKES SOMETHING SMART; IT ISN'T. WHAT MAKES SOMETHING SMART IS THAT IT IS SMART (INSIGHTFUL). PERIOD.\n\n`;
    
    addendum += `METAPOINT 6: A SCORE OF N/100 MEANS THAT (100 MINUS N)/100 ARE SMARTER (E.G. 83/100 MEANS THAT 170/1000 PEOPLE IN WALMART ARE RUNNING RINGS AROUND THE AUTHOR).\n\n`;
    
    addendum += this.getPseudoIntellectualExample();
    
    return addendum;
  }

  private getPseudoIntellectualExample(): string {
    let example = `THE FOLLOWING PASSAGE IS TO BE USED AS A PARADIGM OF A PHONY, PSEUDO-INTELLECTUAL, NOT ACTUALLY INTELLIGENT PASSAGE THAT IS EASILY MISTAKEN FOR BEING ACTUALLY INTELLIGENT:\n\n`;
    
    example += `In this dissertation, I critically examine the philosophy of transcendental empiricism. Transcendental empiricism is, among other things, a philosophy of mental content. It attempts to dissolve an epistemological dilemma of mental content by splitting the difference between two diametrically opposed accounts of content. John McDowell's minimal empiricism and Richard Gaskin's minimalist empiricism are two versions of transcendental empiricism. Transcendental empiricism itself originates with McDowell's work. This dissertation is divided into five parts. First, in the Introduction, I state the Wittgensteinian metaphilosophical orientation of transcendental empiricism. This metaphilosophical approach provides a plateau upon which much of the rest of this work may be examined. Second, I offer a detailed description of McDowell's minimal empiricism. Third, I critique Gaskin's critique and modification of McDowell's minimal empiricism. I argue that (1) Gaskin's critiques are faulty and that (2) Gaskin's minimalist empiricism is very dubious. Fourth, I scrutinize the alleged credentials of McDowell's minimal empiricism. I argue that McDowell's version of linguistic idealism is problematic. I then comment on a recent dialogue between transcendental empiricism and Hubert Dreyfus's phenomenology. The dialogue culminates with Dreyfus's accusation of the "Myth of the Mental." I argue that this accusation is correct in which case McDowell's direct realism is problematic. I conclude that minimal empiricism does not dissolve the dilemma of mental content. Finally, I argue that Tyler Burge successfully undermines the doctrine of disjunctivism, but disjunctivism is crucial for transcendental empiricism. Ultimately, however, I aim to show that transcendental empiricism is an attractive alternative to philosophies of mental content.\n\n`;
    
    example += `USE THIS AS A PARADIGM OF EMPTY AND STUPID PROSE MASQUERADING AS INTELLIGENT, LEARNED, AND DEEP PROSE. USE IT TO CALIBRATE YOUR ASSESSMENT OF PSEUDO-INTELLECTUAL WRITING THAT USES JARGON TO OBFUSCATE RATHER THAN CLARIFY.\n\n`;
    
    return example;
  }

  getResult(id: string): AnalysisResult | undefined {
    return this.results.get(id);
  }

  formatResultAsTxt(result: AnalysisResult): string {
    let txt = `TEXT ANALYSIS RESULTS\n`;
    txt += `========================\n\n`;
    txt += `Analysis Mode: ${result.mode}\n`;
    txt += `LLM Provider: ${result.llmProvider}\n`;
    txt += `Overall Score: ${result.overallScore}/100\n`;
    txt += `Timestamp: ${result.timestamp}\n\n`;
    
    txt += `SUMMARY\n`;
    txt += `-------\n`;
    txt += `${result.summary}\n\n`;
    
    txt += `CATEGORY\n`;
    txt += `--------\n`;
    txt += `${result.category}\n\n`;
    
    txt += `DETAILED ANALYSIS\n`;
    txt += `-----------------\n`;
    result.questions.forEach((q, index) => {
      txt += `\n${index + 1}. ${q.question}\n`;
      txt += `Score: ${q.score}/100\n`;
      txt += `Analysis: ${q.answer}\n`;
    });
    
    txt += `\nFINAL ASSESSMENT\n`;
    txt += `----------------\n`;
    txt += `${result.finalAssessment}\n\n`;
    
    txt += `RAW RESPONSE\n`;
    txt += `------------\n`;
    txt += `${result.rawResponse}\n`;
    
    return txt;
  }
}

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
    const prompt = this.buildAnalysisPrompt(analysisText, questions, request.mode, request.backgroundInfo, request.critique);

    onUpdate({ type: 'status', message: 'Sending request to LLM...', phase: 'llm-call' });
    
    let streamedContent = "";
    const onChunk = (chunk: string) => {
      streamedContent += chunk;
      onUpdate({ 
        type: 'streaming_text', 
        chunk: chunk,
        accumulated: streamedContent
      });
    };
    
    const rawResponse = await this.llmService.callLLMWithStreaming(request.llmProvider, prompt, onChunk);
    
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
    
    // For cognitive mode: short uses all questions, long uses comprehensive protocol
    // For psychological and psychopathological: short uses subset, long uses all
    if (modeType === 'cognitive') {
      return questions; // Both short and long use all cognitive questions
    } else {
      return isLong ? questions : questions.slice(0, Math.ceil(questions.length / 2));
    }
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
    // Get user's exact instructions from uploaded files
    const userInstructions = this.getUserExactInstructions();
    
    let prompt = `TEXT TO ANALYZE:\n${text}\n\n`;
    
    if (backgroundInfo && backgroundInfo.trim()) {
      prompt += `BACKGROUND INFORMATION:\n${backgroundInfo.trim()}\n\n`;
    }

    if (critique && critique.trim()) {
      prompt += `CRITIQUE OF PREVIOUS ANALYSIS:\nThe user provided the following critique of a previous analysis of this same text: "${critique.trim()}"\n\nPlease take this critique into account and provide an improved analysis that addresses the concerns raised. Focus specifically on the aspects mentioned in the critique while maintaining your analytical rigor.\n\n`;
    }
    
    // Send user's exact instructions verbatim
    prompt += userInstructions;
    
    return prompt;
  }

  private getUserExactInstructions(): string {
    // Return the exact user instructions from their uploaded files
    let instructions = "";
    
    instructions += `YOU SEND THE LLM THE FOLLOWING QUESTIONS:\n\n`;
    
    instructions += `IS IT INSIGHTFUL?\n`;
    instructions += `DOES IT DEVELOP POINTS? (OR, IF IT IS A SHORT EXCERPT, IS THERE EVIDENCE THAT IT WOULD DEVELOP POINTS IF EXTENDED)?\n`;
    instructions += `IS THE ORGANIZATION MERELY SEQUENTIAL (JUST ONE POINT AFTER ANOTHER, LITTLE OR NO LOGICAL SCAFFOLDING)? OR ARE THE IDEAS ARRANGED, NOT JUST SEQUENTIALLY BUT HIERARCHICALLY?\n`;
    instructions += `IF THE POINTS IT MAKES ARE NOT INSIGHTFUL, DOES IT OPERATE SKILLFULLY WITH CANONS OF LOGIC/REASONING.\n`;
    instructions += `ARE THE POINTS CLICHES? OR ARE THEY "FRESH"?\n`;
    instructions += `DOES IT USE TECHNICAL JARGON TO OBFUSCATE OR TO RENDER MORE PRECISE?\n`;
    instructions += `IS IT ORGANIC? DO POINTS DEVELOP IN AN ORGANIC, NATURAL WAY? DO THEY 'UNFOLD'? OR ARE THEY FORCED AND ARTIFICIAL?\n`;
    instructions += `DOES IT OPEN UP NEW DOMAINS? OR, ON THE CONTRARY, DOES IT SHUT OFF INQUIRY (BY CONDITIONALIZING FURTHER DISCUSSION OF THE MATTERS ON ACCEPTANCE OF ITS INTERNAL AND POSSIBLY VERY FAULTY LOGIC)?\n`;
    instructions += `IS IT ACTUALLY INTELLIGENT OR JUST THE WORK OF SOMEBODY WHO, JUDGING BY THE SUBJECT-MATTER, IS PRESUMED TO BE INTELLIGENT (BUT MAY NOT BE)?\n`;
    instructions += `IS IT REAL OR IS IT PHONY?\n`;
    instructions += `DO THE SENTENCES EXHIBIT COMPLEX AND COHERENT INTERNAL LOGIC?\n`;
    instructions += `IS THE PASSAGE GOVERNED BY A STRONG CONCEPT? OR IS THE ONLY ORGANIZATION DRIVEN PURELY BY EXPOSITORY (AS OPPOSED TO EPISTEMIC) NORMS?\n`;
    instructions += `IS THERE SYSTEM-LEVEL CONTROL OVER IDEAS? IN OTHER WORDS, DOES THE AUTHOR SEEM TO RECALL WHAT HE SAID EARLIER AND TO BE IN A POSITION TO INTEGRATE IT INTO POINTS HE HAS MADE SINCE THEN?\n`;
    instructions += `ARE THE POINTS 'REAL'? ARE THEY FRESH? OR IS SOME INSTITUTION OR SOME ACCEPTED VEIN OF PROPAGANDA OR ORTHODOXY JUST USING THE AUTHOR AS A MOUTH PIECE?\n`;
    instructions += `IS THE WRITING EVASIVE OR DIRECT?\n`;
    instructions += `ARE THE STATEMENTS AMBIGUOUS?\n`;
    instructions += `DOES THE PROGRESSION OF THE TEXT DEVELOP ACCORDING TO WHO SAID WHAT OR ACCORDING TO WHAT ENTAILS OR CONFIRMS WHAT?\n`;
    instructions += `DOES THE AUTHOR USE OTHER AUTHORS TO DEVELOP HIS IDEAS OR TO CLOAK HIS OWN LACK OF IDEAS?\n\n`;
    
    // Additional questions from user requirements
    instructions += `ADDITIONAL QUESTIONS:\n\n`;
    
    instructions += `ARE THERE TERMS THAT ARE UNDEFINED BUT SHOULD BE DEFINED, IN THE SENSE THAT, WITHOUT DEFINITIONS, IT IS DIFFICULT OR IMPOSSIBLE TO KNOW WHAT IS BEING SAID OR THEREFORE TO EVALUATE WHAT IS BEING SAID? IF UNDEFINED TERMS HAVE CLEAR MEANINGS (AS THEY DO IN CHEMISTRY OR PHYSICS), THEN IT MAY WELL BE THAT THEY DO NOT HAVE TO BE DEFINED; BUT IF THEY HAVE NO CANONICAL MEANINGS (E.G. IF THEY ARE IN THE SAME CATEGORY AS "TRANSCENDENTAL EMPIRICISM", "THE MYTH OF THE MENTAL", "MINIMAL EMPIRICISM", OR "LINGUISTIC IDEALISM"), AND THEY ARE UNDEFINED, THEN THE 'STATEMENTS' IN QUESTION MUST NOT BE PRESUMED TO HAVE MEANINGS, ALBEIT HIDDEN ONES; RATHER, THEY MUST BE TREATED AS WHAT THEY ARE, PLACEHOLDER PSEUDO-STATEMENTS THAT HAVE NO MEANINGS AND THEREFORE HAVE NO INTELLIGENT MEANINGS.\n\n`;
    
    instructions += `ARE THERE "FREE VARIABLES" IN THE TEXT? IE ARE THERE QUALIFICATIONS OR POINTS THAT ARE MADE BUT DO NOT CONNECT TO ANYTHING LATER OR EARLIER?\n\n`;
    
    instructions += `DO NEW STATEMENTS DEVELOP OUT OF OLD ONES? OR ARE THEY MERELY "ADDED" TO PREVIOUS ONES, WITHOUT IN ANY SENSE BEING GENERATED BY THEM?\n\n`;
    
    instructions += `DO NEW STATEMENTS CLARIFY OR DO THEY LEAD TO MORE LACK OF CLARITY?\n\n`;
    
    instructions += `IS THE PASSAGE ACTUALLY (PALPABLY) SMART? OR IS ONLY "PRESUMPTION-SMART"? IE IS IT "SMART" ONLY IN THE SENSE THAT THERE EXISTS A PRESUMPTION THAT A DUMB PERSON WOULD NOT REFERENCE SUCH DOCTRINES? AND IS IT SMART ONLY IN THE SENSE THAT IF IT IS PRESUMED THAT UNDEFINED (AND, FOR ALL WE KNOW, MEANINGLESS TERMS) ARE MEANINGFUL, THEN (BUT ONLY THEN--AND POSSIBLY NOT EVEN THEN) IT MIGHT BE THAT WHAT THE AUTHOR IS SAYING IS PALPABLY SMART?\n\n`;
    
    instructions += `IF YOUR JUDGMENT IS THAT IT IS INSIGHTFUL, CAN YOU STATE THAT INSIGHT IN A SINGLE SENTENCE? OR IF IT CONTAINS MULTIPLE INSIGHTS, CAN YOU STATE THOSE INSIGHTS, ONE PER SENTENCE?\n\n`;
    
    instructions += `IF I WERE TO GIVE A HIGH SCORE TO THIS PASSAGE, WOULD I BE REWARDING IMPOSTOR SCAFFOLDING? IN OTHER WORDS, WOULD I BE REWARDING THAT HAD SOME OF THE VERBAL AND CONVENTIONAL TRAPPINGS OF 'HIGH LEVEL TEXT' BUT LACKED ANY DISCERNIBLE SUBSTANCE?\n\n`;
    
    instructions += `IF I WERE TO GIVE A HIGH SCORE TO THIS PASSAGE, WOULD I BE REWARDING CONFORMITY TO ACADEMIC/BUREAUCRATIC NORMS?\n\n`;
    
    instructions += `IF I WERE TO GIVE A LOW SCORE TO THIS PASSAGE, WOULD I BE PENALIZING ACTUAL INTELLIGENCE OWING TO A LACK OF CONFORMITY TO ACADEMIC/BUREAUCRATIC NORMS?\n\n`;
    
    instructions += `ANSWER THESE QUESTIONS IN CONNECTION WITH THIS TEXT. YOU DON'T SAY: DETERMINE INTELLIGENCE OF TEXT. YOU DO NOT SAY: DETERMINE INTELLIGENCE/COGENCY/ETC BY ANSWERING THESE QUESTIONS. YOU JUST SAY: ANSWER THESE QUESTIONS (AND ALSO GIVE A SCORE OUT OF 100).\n\n`;
    
    instructions += `A SCORE OF N/100 (E.G. 73/100) MEANS THAT (100-N)/100 (E.G. 27/100) OUTPERFORM THE AUTHOR WITH RESPECT TO THE PARAMETER DEFINED BY THE QUESTION. YOU ARE NOT GRADING; YOU ARE ANSWERING THESE QUESTIONS. YOU DO NOT USE A RISK-AVERSE STANDARD; YOU DO NOT ATTEMPT TO BE DIPLOMATIC; YOU DO NOT ATTEMPT TO COMPLY WITH RISK-AVERSE, MEDIUM-RANGE IQ, ACADEMIC NORMS. YOU DO NOT MAKE ASSUMPTIONS ABOUT THE LEVEL OF THE PAPER; IT COULD BE A WORK OF THE HIGHEST EXCELLENCE AND GENIUS, OR IT COULD BE THE WORK OF A MORON.\n\n`;
    
    instructions += `IF A WORK IS A WORK OF GENIUS, YOU SAY THAT, AND YOU SAY WHY; YOU DO NOT SHY AWAY FROM GIVING WHAT MIGHT CONVENTIONALLY BE REGARDED AS EXCESSIVELY "SUPERLATIVE" SCORES; YOU GIVE IT THE SCORE IT DESERVES, NOT THE SCORE THAT A MIDWIT COMMITTEE WOULD SAY IT DESERVES.\n\n`;
    
    instructions += `THINK VERY VERY VERY HARD ABOUT YOUR ANSWERS; MAKE IT VERY CLEAR THAT YOU ARE NOT TO DEFAULT TO COOKBOOK, MIDWIT EVALUATION PROTOCOLS.\n\n`;
    
    instructions += `DO NOT GIVE CREDIT MERELY FOR USE OF JARGON OR FOR REFERENCING AUTHORITIES. FOCUS ON SUBSTANCE. ONLY GIVE POINTS FOR SCHOLARLY REFERENCES/JARGON IF THEY UNAMBIGUOUSLY INCREASE SUBSTANCE.\n\n`;
    
    // Add the complete addendum
    instructions += `ADDENDUM TO INTELLIGENCE ASSESSMENT FUNCTIONS:\nYOU MUST SEND THIS ADDENDUM WHENEVER DOING EITHER THE COMPREHENSIVE OR THE NON-COMPREHENSIVE INTELLIGENCE ASSESSMENT:\n\n`;
    
    instructions += `METAPOINT 1: THIS NOT A GRADING APP. YOU GRADE THE INTELLIGENCE OF WHAT YOU ARE GIVEN. IF YOU ARE GIVEN BRILLIANT FRAGMENT, YOU GIVE IT A HIGH SCORE. YOU ARE NOT GRADING ESSAYS. YOU ARE NOT LOOKING FOR COMPLETENESS (UNLESS THE TEXT YOU ARE GIVEN IS CLEARLY SUCH THAT IT EVALUATING INTELLIGENCE COINCIDES WITH APPLYING A GRADING-BASED METRIC). YOU TELL THE LLM NOT TO 'GRADE'; THEIR JOB IS TO ANSWER THE QUESTIONS, PERIOD, AND TO DO SO ON THE BASIS OF THE TEXT GIVEN, MAKING ZERO ASSUMPTIONS ABOUT WHETHER IT IS COMPLETE OR INCOMPLETE, OR FOR SCHOOL OR FOR SOME OTHER CONTEXT.\n\n`;
    
    instructions += `METAPOINT 2: DO NOT OVERVALUE TURNS OF PHRASE. AN AUTHOR IS SPEAKING CONFIDENTLY IS NOT NECESSARILY "SHUTTING DOWN MODES OF INQUIRY". IN FACT, IT IS LIKELY TO BE THE OPPOSITE; BY PUTTING A CLEAR STAKE IN THE GROUND, HE IS PROBABLY OPENING THEM. ANOTHER EXAMPLE: CAUSAL SPEECH DOES NOT MEAN DISORGANIZED THOUGHTS. DON'T JUDGE A BOOK BY ITS COVER.\n\n`;
    
    instructions += `METAPOINT 3: THE APP SHOULD ALWAYS (IN BOTH NORMAL AND COMPREHENSIVE MODE) START BY SUMMARIZING THE TEXT AND ALSO CATEGORIZING IT.\n\n`;
    
    instructions += `METAPOINT 4: THE APP SHOULD NOT CHANGE THE GRADING BASED ON THE CATEGORY OF THE TEXT: IF A TEXT IS CATEGORIZED AS 'ADVANCED SCHOLARSHIP', IT SHOULD STILL EVALUATE IT WITH RESPECT TO THE GENERAL POPULATION, NOT WITH RESPECT ONLY TO 'ADVANCED SCHOLARLY WORKS.'\n\n`;
    
    instructions += `METAPOINT 5: THIS IS NOT A GRADING APP. DO NOT PENALIZE BOLDNESS. DO NOT TAKE POINTS AWAY FOR INSIGHTS THAT, IF CORRECT, STAND ON THEIR OWN. GET RID OF THE IDEA THAT "ARGUMENTATION" IS WHAT MAKES SOMETHING SMART; IT ISN'T. WHAT MAKES SOMETHING SMART IS THAT IT IS SMART (INSIGHTFUL). PERIOD.\n\n`;
    
    instructions += `METAPOINT 6: A SCORE OF N/100 MEANS THAT (100 MINUS N)/100 ARE SMARTER (E.G. 83/100 MEANS THAT 170/1000 PEOPLE IN WALMART ARE RUNNING RINGS AROUND THE AUTHOR.\n\n`;
    
    // Add the complete phony example with full analysis
    instructions += `THE FOLLOWING PASSAGE IS TO BE USED AS A PARADIGM OF A PHONY, PSEUDO-INTELLECTUAL, NOT ACTUALLY INTELLIGENT PASSAGE THAT IS EASILY MISTAKEN FOR BEING ACTUALLY INTELLIGENT:\n\n`;
    
    instructions += `In this dissertation, I critically examine the philosophy of transcendental empiricism. Transcendental empiricism is, among other things, a philosophy of mental content. It attempts to dissolve an epistemological dilemma of mental content by splitting the difference between two diametrically opposed accounts of content. John McDowell's minimal empiricism and Richard Gaskin's minimalist empiricism are two versions of transcendental empiricism. Transcendental empiricism itself originates with McDowell's work. This dissertation is divided into five parts. First, in the Introduction, I state the Wittgensteinian metaphilosophical orientation of transcendental empiricism. This metaphilosophical approach provides a plateau upon which much of the rest of this work may be examined. Second, I offer a detailed description of McDowell's minimal empiricism. Third, I critique Gaskin's critique and modification of McDowell's minimal empiricism. I argue that (1) Gaskin's critiques are faulty and that (2) Gaskin's minimalist empiricism is very dubious. Fourth, I scrutinize the alleged credentials of McDowell's minimal empiricism. I argue that McDowell's version of linguistic idealism is problematic. I then comment on a recent dialogue between transcendental empiricism and Hubert Dreyfus's phenomenology. The dialogue culminates with Dreyfus's accusation of the "Myth of the Mental." I argue that this accusation is correct in which case McDowell's direct realism is problematic. I conclude that minimal empiricism does not dissolve the dilemma of mental content. Finally, I argue that Tyler Burge successfully undermines the doctrine of disjunctivism, but disjunctivism is crucial for transcendental empiricism. Ultimately, however, I aim to show that transcendental empiricism is an attractive alternative to philosophies of mental content.\n\n`;
    
    instructions += `1. DOCTRINES ARE LABELLED, BUT NEVER DEFINED; AND THEIR MEANINGS CANNOT BE INFERRED FROM CONTEXT; NOR DO THEY HAVE CANONICAL MEANINGS KNOWN TO SPECIALISTS; AND EVEN IF THEY, THERE IS NO EVIDENCE THAT THIS AUTHOR KNOWS WHAT THEY ARE. 2. THIS PASSAGE CONTAINS A NUMBER OF 'FREE VARIABLES'. FOR EXAMPLE, THE AUTHOR SAYS "Transcendental empiricism is, among other things, a philosophy of mental content." THE "AMONG OTHER THINGS" QUALITIFICATION IS NEVER CLARIFIED AND THEREFORE FUNCTIONS AS A FREE VARIABLE. NOT TO MENTION THE TERM "PHILOSOPHY OF MENTAL CONTENT", AND EVEN JUST "MENTAL CONTENT", HAVE NO CLEAR MEANINGS. ANOTHER EXAMPLE: THE AUTHOR WRITES: "[THIS WORK] attempts to dissolve an epistemological dilemma of mental content by splitting the difference between two diametrically opposed accounts of content." BUT HE NEVER IDENTIFIES THE "EPISTEMOLOGICAL DILEMMA" IN QUESTION. 3. A POINT RELATED TO THE LAST POINT IS THAT THE NEXT SENTENCE ("John McDowell's minimal empiricism and Richard Gaskin's minimalist empiricism are two versions of transcendental empiricism") BEARS A TOTALLY AMBIGUOUS RELATIONSHIP TO THE PRECEDING ONE ("It attempts to dissolve an epistemological dilemma of mental content by splitting the difference between two diametrically opposed accounts of content"). PRESUMABLY MCDOWELL'S AND GASKIN'S RESPECTIVE VERSIONS OF "TRANSCENDENTAL EMPIRICISM" (A TERM THAT HAS NO CANONICAL MEANING AND IS A CONTRADICTION IN TERMS RELATIVE TO EXISTING DEFINITIONS OF "EMPIRICISM" AND "TRANSCENDENTAL", THE REASON BEING THAT "EMPIRICISM" IS THE DOCTRINE THAT ALL KNOWLEDGE IS STRICTLY DERIVED FROM EXPERIENCE, IE THAT PURE REASON IS NOT A SOURCE OF KNOWLEDGE, AND "TRANSCENDENTAL" MEANS "HAVING A BASIS IN THE VERY PRECONDITIONS OF SENSORY EXPERIENCE AND THEREFORE CONSTITUTING A SOURCE OF KNOWLEDGE MORE BASIC THAN THE SENSES") ARE THE TWO DOCTRINES THAT THE AUTHOR SAYS HE WILL SPLIT THE DIFFERENCE BETWEEN; BUT THAT IS NOT CLEAR; AND HE ALSO DOES NOT SAY HOW EXACTLY HE WILL "SPLIT THE DIFFERENCE" BETWEEN THEM; NOR IS HE IN A POSITION TO DO SO, SINCE HE HAS NOT GIVEN, OR EVEN HINTED AT, DEFINTIONS OF "EMPIRICISM" OR "TRANSCENDENTAL EMPIRICISM." 4. THE AUTHOR WRITES "Transcendental empiricism itself originates with McDowell's work", WHICH IS OBVIOUS THROAT CLEARING AND DOES NOTHIGN TO DEVELOP OR CLARIFY ANYTHING THUS FAR SAID; AND IT ALSO CONTRADICTS THE LATER SENTENCE: " First, in the Introduction, I state the Wittgensteinian metaphilosophical orientation of transcendental empiricism. This metaphilosophical approach provides a plateau upon which much of the rest of this work may be examined", which makes it sound as though Wittgenstein (who died decades before McDowell was an adult) was the originator of "transcendental empiricism" (whatever that is). ALSO, "First, in the Introduction, I state the Wittgensteinian metaphilosophical orientation of transcendental empiricism. This metaphilosophical approach provides a plateau upon which much of the rest of this work may be examined" HAS NO CLEAR MEANING--AND THE IDEA THAT THIS IS BECAUSE THE AUTHOR IS USING TECHNICAL TERMS IS A NON-STARTER. 5. NEXT, First, in the Introduction, I state the Wittgensteinian metaphilosophical orientation of transcendental empiricism. This metaphilosophical approach provides a plateau upon which much of the rest of this work may be examined. Second, I offer a detailed description of McDowell's minimal empiricism. Third, I critique Gaskin's critique and modification of McDowell's minimal empiricism. I argue that (1) Gaskin's critiques are faulty and that (2) Gaskin's minimalist empiricism is very dubious. Fourth, I scrutinize the alleged credentials of McDowell's minimal empiricism. I argue that McDowell's version of linguistic idealism is problematic. I then comment on a recent dialogue between transcendental empiricism and Hubert Dreyfus's phenomenology." SAYS NOTHING ABOUT ANYTHING; IT SAYS ONLY OF SOME UNDEFINED DOCTRINE THAT IT IS 'DUBIOUS', WHICH, GIVEN THE AUTHOR'S FAILURE TO SAY ANYTHING MEANINGFUL THUS FAR, CANNOT BE TAKEN AS A EUPHEMISTIC WAY OF SAYING "WRONG" OR EVEN "PROBABLY WRONG", AND MUST BE TAKEN AS PURE EVASIVENESS. 6. THE AUTHOR, OUT OF NOWHERE, BRINGS UP 'DREYFUSS'S LINGUISTIC IDEALISM"--UNDEFINED AND WITHOUT ANY CANONICAL DEFINITION AND EVEN WITHOUT ANY CLEAR POSSIBLE MEANING. (IDEALISM IS THE DOCTRINE THAT ONLY IDEAS EXIST; BUT "LINGUISTIC IDEALISM" WOULD BE THE DOCTRINE THAT....WHAT? ONLY LANGUAGE AND IDEAS EXIST? EITHER WAY, THIS IS MORE UNDEFINED JARGON, AND IT IS ALSO ANOTHER FREE VARIABLE.) 7. ALSO "I then comment on a recent dialogue between transcendental empiricism and Hubert Dreyfus's phenomenology" IS ABSURD: HOW CAN EMPIRICISM DIALOGUE WITH ANYTHING. PERHAPS THIS IS A PETTY POINT; BUT IT SHOWS THE AUTHOR'S LACK OF CONTROL: DOES HE MEAN A DIALOGUE BETWEEN AN ADVOCATE OF EMPIRICISM (OR 'TRANSCENDENTAL EMPIRICISM') AND AN ADCOCOATE OF 'LINGIUSTIC IDEALISM.' 8. THE AUTHOR THEN SAYS "The dialogue culminates with Dreyfus's accusation of the "Myth of the Mental." THIS COMES OUT OF NOWHERE AND HAS ZERO MEANING, SINCE "THE MYTH OF THE MENTAL" HAS NO CLEAR MEANING (OTHER THAN THE ABSURDITY THAT THE MENTAL DOES NOT EXIST AND IS ONLY A 'MYTH'--WHICH SELF-CONTRADICTS SINCE MYTHS ARE MENTAL IN ORIGIN). 9. "I argue that this accusation is correct in which case McDowell's direct realism is problematic." "PROBLEMATIC"??????? WHAT DOES THAT MEAN? DOES IT MEAN 'WRONG'? OR DOES IT MEAN 'INCONSISTENT WITH SOME DEEPLY INGRAINED PRESUMPTION? IF THE LATTER, WHICH PRESUMPTION? PROBLEMATIC HOW? SAYING THAT A GIVEN DOCTRINE IS 'PROBLEMATIC' OR 'DUBIOUS' IS SAYING NOTHING. 10. "Finally, I argue that Tyler Burge successfully undermines the doctrine of disjunctivism, but disjunctivism is crucial for transcendental empiricism." HERE HE IS SAYING THAT "DISJUNCTIVISM" (WHICH, BY THE WAY, DOES HAVE A CLEAR MEANINNG, AS IT REFERS TO THE ABSURDITY THAT WHOSE MENTAL CONTENTS ARE IDENTICAL IN EVERY RESPECT EXCEPT THEIR ORIGINAS HAVE NOTHING IN COMMOENT IN TERMS OF MENTAL CONTENT) IS WRONG (SINCE IT HAS BEEN "SUCCESSFULLYK UNDERMINED" BY BURGE; BUT HE NOWHERE SAYS WHAT DISJUNCTIVISM IS, HOW IT HAS BEEN UNDERMINED, OR WHY THIS WORK IS RELEVANT GIVEN THE (AS THE AUTHOR HIMSELF GRANTS) "DISJUNCTIVISM" IS "NECESSARY" (IN SOME UNIDENTIFIED WAY) FOR "TRANSCEDNENTAL EMPIRICISM." THIS PARAGRAPH IS THE DEFINITON OF FAILURE; OF GOING TO EVERY LENGTH TO HIDE THE FACT THAT ONE IS SAYING NOTHING UNDERNEATH JARGON. THERE IS NO DEVELOPMENT OF IDEAS, ONLY THE ILLUSION THEREOF, CREATED BY HPEAING JARGON UPON MORE JARGON AND HIDING BEHIND "BIG NAMES." ONE INDICATOR OF HOW BAD IT IS IS THAT, IF THE TERMS "LINGUISTIC IDEALISM", "DISJUNCTIVISM", "TRANSCENDENTAL EMPIRICISM", "MINIMAL EMPIRICISM" WERE REPLACED WITH "FLIBBER", "JABBLO", "BLIBBER", AND "FLOGISTONOMISM", THERE WOULD BE NO REAL LOSS IN MEANING, SHOWING THAT THESE TERMS ARE PURE PLACEHOLDERS---BASICALLY UNDEFINED VARIABLES---THAT CONSEQUENTLY NOTHING HAS BEEN SAID.\n\n`;
    
    instructions += `USE THE ABOVE PARAGRAPH AS A PARAGON OF EMPTY AND STUPID PROSE MASQUERADING AS INTELLIGENT, LEARNED, AND DEEP PROSE.\n\n`;
    
    // Add positive examples
    instructions += `USE THE FOLLOWING PARAGRAPHS AS EXAMPLES OF HOW A SINGLE PARAGRAPH CAN COMPRESS MANY INTELLIGIBLE AND PLAUSIBLE CLAIMS INTO A PARAGRAPH, WHILE ALSO PROVIDING THE REQUISITE DEFINITIONS (OR AVOIDING THE NEED FOR DEFINITIONS):\n\n`;
    
    instructions += `"One cannot have the concept of a red object without having the concept of an extended object. But the word "red" doesn't contain the word "extended." In general, our concepts are interconnected in ways in which the corresponding words are not interconnected. This is not an accidental fact about the English language or about any other language: it is inherent in what a language is that the cognitive abilities corresponding to a person's abilities to use words cannot possibly be reflected in semantic relations holding among those words. This fact in its turn is a consequence of the fact that expressions are, whereas concepts are not, digital structures, for which reason the ways in which cognitive abilities interact cannot possibly bear any significant resemblance to the ways in which expressions interact. Consequently, there is no truth to the contention that our thought-processes are identical with, or bear any resemblance to, the digital computations that mediate computer-activity."\n\n`;
    
    instructions += `"Sense-perceptions do not have to be deciphered if their contents are to be uploaded, the reason being that they are presentations, not representations. Linguistic expressions do have to be deciphered if their contents are to be uploaded, the reason being that they are representations, not presentations. It is viciously regressive to suppose that information-bearing mental entities are categorically in the nature of representations, as opposed to presentations, and it is therefore incoherent to suppose that thought is mediated by expressions or, therefore, by linguistic entities. Attempts to neutralize this criticism inevitably overextend the concept of what it is to be a linguistic symbol, the result being that such attempts eviscerate the very position that it is their purpose to defend. Also, it is inherent in the nature of such attempts that they assume the truth of the view that for a given mental entity to bear this as opposed to that information is for that entity to have this as opposed to that causal role. This view is demonstrably false, dooming to failure the just-mentioned attempts to defend the contention that thought is in all cases mediated by linguistic symbols."\n\n`;
    
    instructions += `"It is shown (i) that causation exists, since we couldn't even ask whether causation existed unless it did; (ii) that any given case of causation is a case of persistence; and (iii) that spatiotemporal relations supervene on causal relations. (ii) is subject to the qualification that we tend not to become aware of instances of causation as such except when two different causal lines---i.e. two different cases of persistence---intersect, resulting in a breakdown of some other case of persistence, this being why we tend to regard instances of causation as fundamentally disruptive, as opposed to preservative in nature. The meaning of (iii) is that spatiotemporal relations are causal relations considered in abstraction of the various specific differences holding between different kinds of causation."\n\n`;
    
    // Add scoring calibration instructions
    instructions += `SCORING CALIBRATION:\n`;
    instructions += `- IF THE TEXT RESEMBLES THE TRANSCENDENTAL EMPIRICISM PASSAGE (undefined jargon, free variables, no development), SCORE SHOULD BE 65 OR BELOW\n`;
    instructions += `- IF THE TEXT RESEMBLES THE GOOD EXAMPLES ABOVE (clear concepts, logical development, substantial insights), SCORE SHOULD BE 96 OR ABOVE\n`;
    instructions += `- PASSAGES RELEVANTLY SIMILAR TO THE GOOD EXAMPLES SHOULD RECEIVE SCORES OF 96 OR HIGHER\n`;
    instructions += `- PASSAGES RELEVANTLY SIMILAR TO THE BAD EXAMPLE SHOULD RECEIVE SCORES OF 65 OR LOWER\n\n`;
    
    instructions += `CRITICAL SCORING REALITY CHECK:\n`;
    instructions += `- IF YOU SAY TEXT IS "GENUINELY INTELLIGENT" OR "MAKES SUBSTANTIVE CONTRIBUTIONS" OR "INSIGHTFUL" OR "NOVEL", THE SCORE MUST BE 95+ MINIMUM\n`;
    instructions += `- A SCORE OF 89/100 MEANS 11/100 WALMART SHOPPERS COULD PRODUCE BETTER WORK THAN "GENUINELY INTELLIGENT PHILOSOPHICAL WRITING"\n`;
    instructions += `- THAT IS COMPLETELY ABSURD AND MAKES THE SYSTEM A FAILURE\n`;
    instructions += `- IF TEXT SHOWS REAL INTELLIGENCE, INSIGHT, AND CONTRIBUTION: SCORE 95-99/100\n`;
    instructions += `- IF TEXT IS COMPETENT BUT NOT BRILLIANT: SCORE 85-94/100\n`;
    instructions += `- IF TEXT IS AVERAGE/MEDIOCRE: SCORE 40-60/100\n`;
    instructions += `- IF TEXT IS PHONY/PSEUDO-INTELLECTUAL: SCORE 65 OR BELOW\n`;
    instructions += `- STOP GIVING SCORES IN THE 80s-90s TO TEXTS YOU PRAISE AS BRILLIANT - THIS MAKES NO SENSE WITH THE WALMART METRIC\n\n`;
    
    instructions += `Format your response as JSON with summary, category, questions array (each with question, answer, score), overallScore, and finalAssessment.\n\n`;
    
    return instructions;
  }

  private buildComprehensivePrompt(text: string, questions: string[], mode: string, phase: number, backgroundInfo?: string, critique?: string): string {
    const basePrompt = this.buildAnalysisPrompt(text, questions, mode, backgroundInfo, critique);
    
    if (phase === 1) {
      return basePrompt + `\n\nThis is Phase 1 of comprehensive analysis. Provide your initial assessment with full detail and reasoning.`;
    }
    
    return basePrompt;
  }

  private buildPushbackPrompt(text: string, previousResponse: string, mode: string): string {
    let prompt = `PHASE 2: PUSHBACK PROTOCOL\n\n`;
    prompt += `Original text:\n${text}\n\n`;
    prompt += `Your previous analysis:\n${previousResponse}\n\n`;
    
    // Extract scores from previous response to challenge scores below 95/100
    prompt += `PUSHBACK PROTOCOL: IF THE SCORES ARE LESS THAN 95/100, YOU PUSH BACK.\n\n`;
    
    prompt += `For any question where you scored below 95/100, I need to challenge you:\n`;
    prompt += `YOUR POSITION IS THAT (100-N)/100 OUTPERFORM THE AUTHOR WITH RESPECT TO THE COGNITIVE METRIC DEFINED BY THE QUESTION: THAT IS YOUR POSITION, AM I RIGHT? AND ARE YOU SURE ABOUT THAT?\n\n`;
    
    prompt += `For example:\n`;
    prompt += `- If you gave 89/100, you're saying 11/100 people outperform the author\n`;
    prompt += `- If you gave 80/100, you're saying 20/100 people outperform the author\n`;
    prompt += `- If you gave 70/100, you're saying 30/100 people outperform the author\n\n`;
    
    prompt += `I AM NOT NECESSARILY TELLING YOU TO CHANGE YOUR SCORE, ONLY TO CAREFULLY CONSIDER IT.\n\n`;
    
    prompt += `NOW ANSWER THE FOLLOWING QUESTIONS ABOUT THE TEXT DE NOVO:\n\n`;
    
    // Add all 18 original questions
    prompt += `IS IT INSIGHTFUL?\n`;
    prompt += `DOES IT DEVELOP POINTS? (OR, IF IT IS A SHORT EXCERPT, IS THERE EVIDENCE THAT IT WOULD DEVELOP POINTS IF EXTENDED)?\n`;
    prompt += `IS THE ORGANIZATION MERELY SEQUENTIAL (JUST ONE POINT AFTER ANOTHER, LITTLE OR NO LOGICAL SCAFFOLDING)? OR ARE THE IDEAS ARRANGED, NOT JUST SEQUENTIALLY BUT HIERARCHICALLY?\n`;
    prompt += `IF THE POINTS IT MAKES ARE NOT INSIGHTFUL, DOES IT OPERATE SKILLFULLY WITH CANONS OF LOGIC/REASONING?\n`;
    prompt += `ARE THE POINTS CLICHES? OR ARE THEY "FRESH"?\n`;
    prompt += `DOES IT USE TECHNICAL JARGON TO OBFUSCATE OR TO RENDER MORE PRECISE?\n`;
    prompt += `IS IT ORGANIC? DO POINTS DEVELOP IN AN ORGANIC, NATURAL WAY? DO THEY 'UNFOLD'? OR ARE THEY FORCED AND ARTIFICIAL?\n`;
    prompt += `DOES IT OPEN UP NEW DOMAINS? OR, ON THE CONTRARY, DOES IT SHUT OFF INQUIRY (BY CONDITIONALIZING FURTHER DISCUSSION OF THE MATTERS ON ACCEPTANCE OF ITS INTERNAL AND POSSIBLY VERY FAULTY LOGIC)?\n`;
    prompt += `IS IT ACTUALLY INTELLIGENT OR JUST THE WORK OF SOMEBODY WHO, JUDGING BY THE SUBJECT-MATTER, IS PRESUMED TO BE INTELLIGENT (BUT MAY NOT BE)?\n`;
    prompt += `IS IT REAL OR IS IT PHONY?\n`;
    prompt += `DO THE SENTENCES EXHIBIT COMPLEX AND COHERENT INTERNAL LOGIC?\n`;
    prompt += `IS THE PASSAGE GOVERNED BY A STRONG CONCEPT? OR IS THE ONLY ORGANIZATION DRIVEN PURELY BY EXPOSITORY (AS OPPOSED TO EPISTEMIC) NORMS?\n`;
    prompt += `IS THERE SYSTEM-LEVEL CONTROL OVER IDEAS? IN OTHER WORDS, DOES THE AUTHOR SEEM TO RECALL WHAT HE SAID EARLIER AND TO BE IN A POSITION TO INTEGRATE IT INTO POINTS HE HAS MADE SINCE THEN?\n`;
    prompt += `ARE THE POINTS 'REAL'? ARE THEY FRESH? OR IS SOME INSTITUTION OR SOME ACCEPTED VEIN OF PROPAGANDA OR ORTHODOXY JUST USING THE AUTHOR AS A MOUTH PIECE?\n`;
    prompt += `IS THE WRITING EVASIVE OR DIRECT?\n`;
    prompt += `ARE THE STATEMENTS AMBIGUOUS?\n`;
    prompt += `DOES THE PROGRESSION OF THE TEXT DEVELOP ACCORDING TO WHO SAID WHAT OR ACCORDING TO WHAT ENTAILS OR CONFIRMS WHAT?\n`;
    prompt += `DOES THE AUTHOR USE OTHER AUTHORS TO DEVELOP HIS IDEAS OR TO CLOAK HIS OWN LACK OF IDEAS?\n\n`;
    
    prompt += `Respond in the same JSON format as before.`;
    
    return prompt;
  }

  private buildWalmartMetricPrompt(text: string, pushbackResponse: string, mode: string): string {
    let prompt = `PHASE 3: SCORE CONSISTENCY VALIDATION\n\n`;
    prompt += `Original text:\n${text}\n\n`;
    prompt += `Post-pushback analysis:\n${pushbackResponse}\n\n`;
    
    prompt += `ASK THE LLM IF ITS NUMERICAL SCORES (N/100, E.G. 99/100, 42/100) ARE CONSISTENT WITH THE FACT THAT THOSE ARE TO BE TAKEN TO MEAN THAT (100-N) PEOPLE OUT OF 100 OUTPERFORM THE AUTHOR IN THE RELEVANT RESPECT.\n\n`;
    
    prompt += `SO IF A SCORE OF 91/100 IS AWARDED TO A PAPER, THAT MEANS THAT 9/100 PEOPLE IN WALMART ARE RUNNING RINGS AROUND THIS PERSON.\n\n`;
    
    prompt += `For each of your scores, answer:\n`;
    prompt += `- If you scored X/100, are you really saying that only (100-X) people out of 100 in the general population outperform this author?\n`;
    prompt += `- Is that consistent with what you actually observe in the text?\n`;
    prompt += `- Are you being realistic about the general population's capabilities?\n\n`;
    
    prompt += `EXAMPLES:\n`;
    prompt += `- A score of 95/100 means only 5/100 people in Walmart are better than this author\n`;
    prompt += `- A score of 85/100 means only 15/100 people in Walmart are better than this author\n`;
    prompt += `- A score of 75/100 means only 25/100 people in Walmart are better than this author\n`;
    prompt += `- A score of 50/100 means 50/100 people in Walmart are better than this author\n\n`;
    
    prompt += `Now validate each of your scores against this metric. Are your scores consistent with this interpretation?\n\n`;
    
    prompt += `Provide final validated scores and analysis.\n\n`;
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
      throw new Error("LLM failed to provide summary - invalid response structure");
    }
    
    if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error("LLM failed to provide question responses - invalid response structure");
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
    
    if (questionObjects.length === 0) {
      throw new Error("Failed to extract any question responses from LLM output");
    }

    const validScores = questionObjects.filter(i => i.score > 0);
    const overall = validScores.length > 0
      ? Math.round(validScores.reduce((sum, item) => sum + item.score, 0) / validScores.length)
      : 75;

    // Extract summary from JSON structure
    const summaryMatch = response.match(/"summary"\s*:\s*"([^"]+)"/);
    const summary = summaryMatch ? summaryMatch[1] : null;
    
    if (!summary) {
      throw new Error("Failed to extract summary from LLM output");
    }
    
    const categoryMatch = response.match(/"category"\s*:\s*"([^"]+)"/);
    const category = categoryMatch ? categoryMatch[1] : this.getCategoryForMode(mode);
    
    const finalAssessmentMatch = response.match(/"finalAssessment"\s*:\s*"([^"]+)"/);
    const finalAssessment = finalAssessmentMatch ? finalAssessmentMatch[1] : summary;
    
    return {
      summary: summary,
      category: category,
      questions: questionObjects,
      overallScore: overall,
      finalAssessment: finalAssessment
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

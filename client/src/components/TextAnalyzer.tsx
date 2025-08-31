import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ChunkSelector from "./ChunkSelector";
import ResultsDisplay from "./ResultsDisplay";
import { Brain, Download, Upload, Trash2, FileText, RotateCcw } from "lucide-react";
import type { AnalysisRequest, AnalysisResult, FileUpload } from "@shared/schema";
import type { TextChunk } from "@/lib/analysisTypes";

export default function TextAnalyzer() {
  const [inputText, setInputText] = useState("");
  const [backgroundInfo, setBackgroundInfo] = useState("");
  const [selectedMode, setSelectedMode] = useState<AnalysisRequest["mode"]>("cognitive-short");
  const [selectedLLM, setSelectedLLM] = useState<AnalysisRequest["llmProvider"]>("zhi1");
  const [chunks, setChunks] = useState<TextChunk[]>([]);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCritiqueAnalyzing, setIsCritiqueAnalyzing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [showStreamingText, setShowStreamingText] = useState(false);
  
  const { toast } = useToast();
  
  // Add global error handler for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      if (event.reason?.name === 'AbortError') {
        // Silently ignore AbortErrors from cancelled requests
        event.preventDefault();
        return;
      }
      // Let other errors bubble up
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
  
  const wordCount = inputText.trim().split(/\s+/).filter(word => word.length > 0).length;
  const charCount = inputText.length;
  const isChunkingRequired = wordCount > 1000;

  // File upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiRequest("POST", "/api/upload", formData);
      return await response.json() as FileUpload;
    },
    onSuccess: (data) => {
      setInputText(data.content);
      
      // Automatically chunk if text is over 1000 words
      if (data.wordCount > 1000) {
        chunkMutation.mutate(data.content);
      } else {
        setChunks([]);
      }
      
      toast({
        title: "File uploaded successfully",
        description: `Parsed ${data.wordCount} words from ${data.filename}${data.wordCount > 1000 ? ' - Text will be chunked for analysis' : ''}`
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Chunk generation mutation
  const chunkMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/chunk", { text });
      return await response.json() as { chunks: TextChunk[] };
    },
    onSuccess: (data) => {
      setChunks(data.chunks);
    },
    onError: (error) => {
      toast({
        title: "Chunking failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // State for streaming updates
  const [streamingStatus, setStreamingStatus] = useState<string>("");
  const [streamingPhase, setStreamingPhase] = useState<string>("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Analysis with streaming using fetch (since we need POST request)
  const performStreamingAnalysis = useCallback(async (request: AnalysisRequest) => {
    // Create abort controller to allow cancellation
    const controller = new AbortController();
    setAbortController(controller);
    setIsAnalyzing(true);
    setStreamingStatus("Connecting...");
    setStreamingPhase("");
    setStreamingText("");
    setShowStreamingText(false);
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      console.log('Starting to read streaming response...');
      
      try {
        while (true) {
          const { done, value } = await reader.read().catch((readError) => {
            if (readError.name === 'AbortError') {
              return { done: true, value: undefined };
            }
            throw readError;
          });
          
          if (done) {
            console.log('Stream completed');
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data) {
                try {
                  const update = JSON.parse(data);
                  console.log('Received streaming update:', update);
                  
                  if (update.type === 'status') {
                    setStreamingStatus(update.message);
                    setStreamingPhase(update.phase);
                  } else if (update.type === 'streaming_text') {
                    // Show real-time LLM response as it's being generated
                    setStreamingText(update.accumulated);
                    setShowStreamingText(true);
                    setStreamingStatus(`Generating analysis... (${update.accumulated.length} chars)`)
                  } else if (update.type === 'progress') {
                    // Show partial results as they come in
                    const partialResult: AnalysisResult = {
                      id: 'streaming',
                      mode: request.mode,
                      llmProvider: request.llmProvider,
                      ...update.result,
                      timestamp: new Date().toISOString(),
                      rawResponse: ''
                    };
                    setCurrentResult(partialResult);
                  } else if (update.type === 'complete') {
                    console.log('Analysis completed, final result:', update.result);
                    setCurrentResult(update.result);
                    setIsAnalyzing(false);
                    setStreamingStatus("");
                    setStreamingPhase("");
                    toast({
                      title: "Analysis completed",
                      description: `Overall score: ${update.result.overallScore}/100`
                    });
                    return;
                  } else if (update.type === 'error') {
                    throw new Error(update.error);
                  }
                } catch (parseError) {
                  console.error('Error parsing streaming data:', parseError, 'Raw data:', data);
                  // Continue processing other lines instead of stopping
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Analysis was cancelled by user');
        return;
      }
      
      console.error('Streaming analysis failed:', error);
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setAbortController(null);
      setIsAnalyzing(false);
      setStreamingStatus("");
      setStreamingPhase("");
    }
  }, [toast]);

  // Handle critique-based analysis
  const performCritiqueAnalysis = useCallback(async (critique: string) => {
    if (!inputText.trim() || !currentResult) {
      toast({
        title: "Cannot regenerate",
        description: "Original text and analysis required for critique",
        variant: "destructive"
      });
      return;
    }

    const request: AnalysisRequest = {
      text: inputText,
      backgroundInfo: backgroundInfo.trim() || undefined,
      mode: selectedMode,
      llmProvider: selectedLLM,
      critique: critique // Add critique to the request
    };

    setIsCritiqueAnalyzing(true);
    
    try {
      await performStreamingAnalysis(request);
      toast({
        title: "Analysis regenerated",
        description: "New analysis generated based on your critique"
      });
    } catch (error) {
      // Error already handled in performStreamingAnalysis
    } finally {
      setIsCritiqueAnalyzing(false);
    }
  }, [inputText, backgroundInfo, selectedMode, selectedLLM, currentResult, performStreamingAnalysis, toast]);

  // Handle meta-analysis of existing results
  const handleMetaAnalysis = useCallback(async (result: AnalysisResult) => {
    if (!inputText) {
      toast({
        title: "No original text",
        description: "Original text is required for meta-analysis",
        variant: "destructive"
      });
      return;
    }

    try {
      const analysisRequest: AnalysisRequest = {
        text: inputText,
        mode: "meta-analysis" as AnalysisRequest["mode"],
        llmProvider: selectedLLM,
        originalAnalysis: {
          id: result.id,
          summary: result.summary,
          category: result.category,
          questions: result.questions,
          overallScore: result.overallScore,
          finalAssessment: result.finalAssessment,
          mode: result.mode,
          llmProvider: result.llmProvider
        }
      };

      await performStreamingAnalysis(analysisRequest);
      
    } catch (error) {
      console.error('Meta-analysis failed:', error);
      toast({
        title: "Meta-analysis failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  }, [inputText, selectedLLM, toast, performStreamingAnalysis]);

  const validateFile = (file: File): boolean => {
    const allowedTypes = [
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf'
    ];
    const allowedExtensions = ['.txt', '.doc', '.docx', '.pdf'];
    
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    return allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension);
  };

  const processFile = useCallback((file: File) => {
    if (!validateFile(file)) {
      toast({
        title: "Invalid file type",
        description: "Please upload TXT, DOC, DOCX, or PDF files only",
        variant: "destructive"
      });
      return;
    }
    uploadMutation.mutate(file);
  }, [uploadMutation, toast]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleTextInput = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value;
    setInputText(text);
    
    // Generate chunks if text is long enough
    if (text.trim().split(/\s+/).length > 1000) {
      chunkMutation.mutate(text);
    } else {
      setChunks([]);
    }
  }, [chunkMutation]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processFile(files[0]);
    }
  }, [processFile]);

  const handleAnalyze = useCallback(() => {
    if (!inputText.trim()) {
      toast({
        title: "No text to analyze",
        description: "Please enter or upload some text first",
        variant: "destructive"
      });
      return;
    }

    // CRITICAL: Mandatory chunking for texts over 1000 words
    if (isChunkingRequired) {
      if (chunks.length === 0) {
        toast({
          title: "Text must be chunked",
          description: "Texts over 1000 words must be processed in chunks. Please wait for chunking to complete.",
          variant: "destructive"
        });
        return;
      }
      
      const selectedChunks = chunks.filter(chunk => chunk.selected);
      if (selectedChunks.length === 0) {
        toast({
          title: "No chunks selected",
          description: "Please select at least one chunk to analyze. Sequential processing with 10-second delays will be used.",
          variant: "destructive"
        });
        return;
      }
      
      // Warning about sequential processing
      if (selectedChunks.length > 1) {
        toast({
          title: "Sequential processing initiated",
          description: `Processing ${selectedChunks.length} chunks sequentially with 10-second delays between chunks`,
        });
      }
    }

    const request: AnalysisRequest = {
      text: inputText,
      backgroundInfo: backgroundInfo.trim() || undefined,
      mode: selectedMode,
      llmProvider: selectedLLM,
      chunks: chunks.length > 0 ? chunks : undefined
    };

    performStreamingAnalysis(request);
  }, [inputText, backgroundInfo, selectedMode, selectedLLM, chunks, isChunkingRequired, performStreamingAnalysis, toast]);

  // New Analysis function that clears everything and stops ongoing analysis
  const handleNewAnalysis = useCallback(() => {
    try {
      // Stop any ongoing analysis
      if (abortController) {
        abortController.abort();
      }
      
      // Clear all state
      setInputText("");
      setBackgroundInfo("");
      setCurrentResult(null);
      setChunks([]);
      setIsAnalyzing(false);
      setStreamingStatus("");
      setStreamingPhase("");
      setIsDragOver(false);
      setAbortController(null);
      
      // Reset file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
      
      toast({
        title: "New analysis started",
        description: "All data cleared and ready for new analysis"
      });
    } catch (error) {
      console.error('Error during new analysis:', error);
      // Force clear state regardless of error
      setInputText("");
      setBackgroundInfo("");
      setCurrentResult(null);
      setChunks([]);
      setIsAnalyzing(false);
      setStreamingStatus("");
      setStreamingPhase("");
      setIsDragOver(false);
      setAbortController(null);
    }
  }, [abortController, toast]);

  const handleDownload = useCallback(async () => {
    if (!currentResult) return;

    try {
      const response = await fetch(`/api/download/${currentResult.id}`);
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analysis-${currentResult.id}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Could not download results",
        variant: "destructive"
      });
    }
  }, [currentResult, toast]);

  const getLLMDisplayName = (provider: string) => {
    const names = {
      zhi1: "ZHI 1",
      zhi2: "ZHI 2", 
      zhi3: "ZHI 3",
      zhi4: "ZHI 4"
    };
    return names[provider as keyof typeof names] || provider;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Compact Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-foreground">Text Evaluator</h1>
            
            <div className="flex items-center gap-2 text-xs">
              <Select value={selectedMode} onValueChange={(value) => setSelectedMode(value as AnalysisRequest["mode"])}>
                <SelectTrigger className="w-32 h-7 text-xs" data-testid="select-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cognitive-short">Cognitive</SelectItem>
                  <SelectItem value="psychological-short">Psychological</SelectItem>
                  <SelectItem value="psychopathological-short">Psychopathological</SelectItem>
                  <SelectItem value="meta-analysis">Meta-Analysis</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedLLM} onValueChange={(value) => setSelectedLLM(value as AnalysisRequest["llmProvider"])}>
                <SelectTrigger className="w-20 h-7 text-xs" data-testid="select-llm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zhi1">ZHI 1</SelectItem>
                  <SelectItem value="zhi2">ZHI 2</SelectItem>
                  <SelectItem value="zhi3">ZHI 3</SelectItem>
                  <SelectItem value="zhi4">ZHI 4</SelectItem>
                </SelectContent>
              </Select>

              <Button 
                onClick={handleAnalyze}
                disabled={isAnalyzing || !inputText.trim()}
                size="sm"
                className="h-7"
                data-testid="button-analyze"
              >
                <Brain className="mr-1 h-3 w-3" />
                {isAnalyzing ? "..." : "Analyze"}
              </Button>
              
              <Button 
                variant="outline" 
                onClick={handleDownload}
                disabled={!currentResult}
                size="sm"
                className="h-7"
                data-testid="button-download"
              >
                <Download className="mr-1 h-3 w-3" />
                Download
              </Button>

              <Button 
                variant="outline" 
                onClick={handleNewAnalysis}
                size="sm"
                className="h-7 bg-red-50 hover:bg-red-100 text-red-700 border-red-200 hover:border-red-300"
                data-testid="button-new-analysis"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                New Analysis
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-80px)]">
          {/* Text Input Panel */}
          <div className="flex flex-col space-y-3">
            <Card className="flex-1 flex flex-col">
              <CardContent className="p-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-card-foreground">Text Input</h2>
                  <div className="flex items-center gap-2">
                    <Label className="px-3 py-1.5 text-sm font-medium border border-border rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors">
                      <Upload className="mr-2 h-4 w-4 inline" />
                      Upload
                      <input 
                        type="file" 
                        className="hidden" 
                        accept=".txt,.doc,.docx,.pdf"
                        onChange={handleFileUpload}
                        data-testid="input-file-upload"
                      />
                    </Label>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setInputText("")}
                      data-testid="button-clear"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                </div>

                <div 
                  className={`flex-1 relative ${isDragOver ? 'bg-accent/20 border-accent border-2 border-dashed' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Textarea 
                    className="flex-1 resize-none w-full h-full"
                    placeholder="Type, paste, or drag & drop your text/PDF/Word files here..."
                    value={inputText}
                    onChange={handleTextInput}
                    data-testid="textarea-input"
                  />
                  {isDragOver && (
                    <div className="absolute inset-0 bg-accent/10 border-2 border-dashed border-accent rounded-md flex items-center justify-center pointer-events-none">
                      <div className="text-center">
                        <Upload className="mx-auto h-8 w-8 text-accent mb-2" />
                        <p className="text-sm font-medium text-accent">Drop your file here</p>
                        <p className="text-xs text-muted-foreground">TXT, DOC, DOCX, PDF</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Background Information */}
                <div className="mt-3 pt-3 border-t border-border">
                  <Label htmlFor="background-info" className="text-sm font-medium mb-2 block">
                    Background Information (Optional)
                  </Label>
                  <Textarea 
                    id="background-info"
                    className="resize-none h-16"
                    placeholder="e.g., 'This is an abstract of a philosophy paper' or 'This is a fragment of a 900-page empirical study'"
                    value={backgroundInfo}
                    onChange={(e) => setBackgroundInfo(e.target.value)}
                    data-testid="textarea-background"
                  />
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <div className="text-sm text-muted-foreground">
                    <span data-testid="text-word-count">{wordCount}</span> words
                    <span className="mx-2">•</span>
                    <span data-testid="text-char-count">{charCount}</span> characters
                  </div>
                  {isChunkingRequired && (
                    <div className="text-sm text-muted-foreground">
                      <span>Text will be chunked for analysis</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Chunk Selection Panel */}
            {chunks.length > 0 && (
              <ChunkSelector 
                chunks={chunks} 
                onChunksChange={setChunks}
              />
            )}
          </div>

          {/* Results Panel */}
          <ResultsDisplay 
            result={currentResult}
            isAnalyzing={isAnalyzing}
            currentLLM={getLLMDisplayName(selectedLLM)}
            streamingStatus={streamingStatus}
            streamingPhase={streamingPhase}
            streamingText={streamingText}
            showStreamingText={showStreamingText}
            onCritiqueAnalysis={performCritiqueAnalysis}
            isCritiqueAnalyzing={isCritiqueAnalyzing}
            onMetaAnalysis={handleMetaAnalysis}
          />
        </div>
      </main>
    </div>
  );
}

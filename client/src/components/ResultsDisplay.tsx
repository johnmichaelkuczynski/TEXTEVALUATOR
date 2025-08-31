import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Copy, FileText, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { AnalysisResult } from "@shared/schema";
import { useState } from "react";

interface ResultsDisplayProps {
  result: AnalysisResult | null;
  isAnalyzing: boolean;
  currentLLM: string;
  streamingStatus?: string;
  streamingPhase?: string;
  streamingText?: string;
  showStreamingText?: boolean;
  onCritiqueAnalysis?: (critique: string) => void;
  isCritiqueAnalyzing?: boolean;
  onMetaAnalysis?: (result: AnalysisResult) => void;
}

export default function ResultsDisplay({ result, isAnalyzing, currentLLM, streamingStatus, streamingPhase, streamingText, showStreamingText, onCritiqueAnalysis, isCritiqueAnalyzing, onMetaAnalysis }: ResultsDisplayProps) {
  const { toast } = useToast();
  const [critique, setCritique] = useState("");

  const handleCritiqueSubmit = () => {
    if (!critique.trim()) {
      toast({
        title: "Critique required",
        description: "Please enter your critique before regenerating the analysis",
        variant: "destructive"
      });
      return;
    }

    if (onCritiqueAnalysis) {
      onCritiqueAnalysis(critique);
      setCritique(""); // Clear the critique box after submission
    }
  };

  const copyResults = async () => {
    if (!result) return;

    try {
      const text = formatResultAsText(result);
      await navigator.clipboard.writeText(text);
      toast({
        title: "Results copied",
        description: "Analysis results copied to clipboard"
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy results to clipboard",
        variant: "destructive"
      });
    }
  };

  const formatResultAsText = (result: AnalysisResult): string => {
    let text = `TEXT ANALYSIS RESULTS\n`;
    text += `========================\n\n`;
    text += `Analysis Mode: ${result.mode}\n`;
    text += `LLM Provider: ${result.llmProvider}\n`;
    text += `Overall Score: ${result.overallScore}/100\n`;
    text += `Timestamp: ${new Date(result.timestamp).toLocaleString()}\n\n`;
    
    text += `SUMMARY\n`;
    text += `-------\n`;
    text += `${result.summary}\n\n`;
    
    text += `CATEGORY\n`;
    text += `--------\n`;
    text += `${result.category}\n\n`;
    
    text += `DETAILED ANALYSIS\n`;
    text += `-----------------\n`;
    result.questions.forEach((q, index) => {
      text += `\n${index + 1}. ${q.question}\n`;
      text += `Score: ${q.score}/100\n`;
      text += `Analysis: ${q.answer}\n`;
    });
    
    text += `\nFINAL ASSESSMENT\n`;
    text += `----------------\n`;
    text += `${result.finalAssessment}\n`;
    
    return text;
  };

  return (
    <div className="flex flex-col space-y-4">
      <Card className="flex-1 flex flex-col">
        <CardContent className="p-4 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-card-foreground">Analysis Results</h2>
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <div className="flex flex-col">
                  <span>Analyzing with {currentLLM}...</span>
                  {streamingStatus && (
                    <span className="text-xs opacity-75">{streamingStatus}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 border border-border rounded-md bg-background">
            {!result && !isAnalyzing ? (
              // Empty State
              <div className="h-full flex items-center justify-center text-center p-8">
                <div className="space-y-3">
                  <div className="text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-4 text-primary/20" />
                  </div>
                  <h3 className="text-lg font-medium text-card-foreground">Ready for Analysis</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Enter or upload text above, select your analysis mode and LLM provider, then click "Analyze" to begin.
                  </p>
                </div>
              </div>
            ) : result ? (
              // Results Content
              <div className="p-4 h-full overflow-y-auto">
                {/* Analysis Header */}
                <div className="mb-6 pb-4 border-b border-border">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-md font-semibold text-card-foreground">
                      {result.mode.charAt(0).toUpperCase() + result.mode.slice(1).replace('-', ' ')} Analysis
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Overall Score:</span>
                      <span className="text-lg font-bold text-primary" data-testid="text-overall-score">
                        {result.overallScore}/100
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Analyzed by <span className="font-medium">{currentLLM}</span> • 
                    <span className="ml-1">{new Date(result.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                {/* Text Summary */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-card-foreground mb-2">Text Summary</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-summary">
                    {result.summary}
                  </p>
                </div>

                {/* Category Classification */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-card-foreground mb-2">Classification</h4>
                  <Badge variant="secondary" data-testid="badge-category">
                    {result.category}
                  </Badge>
                </div>

                {/* Detailed Analysis */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-card-foreground">Detailed Assessment</h4>
                  
                  {result.questions.map((question, index) => (
                    <div key={index} className="border border-border rounded-md p-4" data-testid={`question-${index}`}>
                      <div className="flex items-start justify-between mb-2">
                        <h5 className="text-sm font-medium text-card-foreground leading-relaxed pr-4">
                          {question.question}
                        </h5>
                        <span className="text-sm font-bold text-primary flex-shrink-0">
                          {question.score}/100
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {question.answer}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Final Assessment */}
                <div className="mt-6 pt-4 border-t border-border">
                  <h4 className="text-sm font-semibold text-card-foreground mb-2">Final Assessment</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-final-assessment">
                    {result.finalAssessment}
                  </p>
                </div>
              </div>
            ) : (
              // Loading State with Real-Time Streaming
              <div className="h-full p-4">
                <div className="text-center mb-6">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {streamingStatus || "Analyzing text..."}
                  </p>
                  {streamingPhase && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Phase: {streamingPhase}
                    </p>
                  )}
                </div>
                
                {/* CHUNKED DELIVERY PROGRESS */}
                {streamingPhase && (streamingPhase.includes('protocol-chunk') || streamingPhase.includes('text-chunk')) && (
                  <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      <div className="flex justify-between items-center">
                        <span>Chunked Protocol Delivery</span>
                        <span className="text-xs">Processing...</span>
                      </div>
                      <div className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                        Protocol chunks: 2s delays • Text chunks: 1s delays
                      </div>
                    </div>
                  </div>
                )}
                
                {/* REAL-TIME STREAMING TEXT DISPLAY */}
                {showStreamingText && streamingText && (
                  <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                    <div className="flex items-center space-x-2 mb-3">
                      <Brain className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium text-green-600 dark:text-green-400">
                        Live Analysis Generation
                      </span>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {streamingText}
                        <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-1"></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
            <div className="text-xs text-muted-foreground">
              {result?.mode.includes('long') ? 'Comprehensive Mode' : 'Normal Mode'} • 
              Unfiltered LLM Output
            </div>
            <div className="flex items-center gap-2">
              {onMetaAnalysis && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => result && onMetaAnalysis(result)}
                  disabled={!result}
                  data-testid="button-meta-analysis"
                >
                  <Brain className="mr-2 h-4 w-4" />
                  Meta-Analysis
                </Button>
              )}
              <Button 
                variant="outline" 
                size="sm"
                onClick={copyResults}
                disabled={!result}
                data-testid="button-copy"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {/* Download handled in parent */}}
                disabled={!result}
                data-testid="button-export"
              >
                <FileText className="mr-2 h-4 w-4" />
                Export TXT
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critique Box - Only show when there's a result and not currently analyzing */}
      {result && !isAnalyzing && onCritiqueAnalysis && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageCircle className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold text-card-foreground">Critique & Regenerate</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Provide feedback on the analysis above to generate an improved version that addresses your concerns.
            </p>
            
            <Textarea
              placeholder="Enter your critique here... (e.g., 'The analysis missed the author's main argument about...', 'Please focus more on the rhetorical techniques...', 'The scoring seems too harsh...')"
              value={critique}
              onChange={(e) => setCritique(e.target.value)}
              className="min-h-[100px] mb-3"
              disabled={isCritiqueAnalyzing}
              data-testid="textarea-critique"
            />
            
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                The regenerated analysis will use your original text with this critique as guidance.
              </div>
              <Button 
                onClick={handleCritiqueSubmit}
                disabled={!critique.trim() || isCritiqueAnalyzing}
                data-testid="button-regenerate"
                className="ml-3"
              >
                {isCritiqueAnalyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate Analysis
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

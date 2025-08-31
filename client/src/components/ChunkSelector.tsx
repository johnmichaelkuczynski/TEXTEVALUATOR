import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Scissors } from "lucide-react";
import type { TextChunk } from "@/lib/analysisTypes";

interface ChunkSelectorProps {
  chunks: TextChunk[];
  onChunksChange: (chunks: TextChunk[]) => void;
}

export default function ChunkSelector({ chunks, onChunksChange }: ChunkSelectorProps) {
  const selectedCount = chunks.filter(chunk => chunk.selected).length;

  const toggleChunk = (chunkId: string) => {
    const updatedChunks = chunks.map(chunk => 
      chunk.id === chunkId ? { ...chunk, selected: !chunk.selected } : chunk
    );
    onChunksChange(updatedChunks);
  };

  const selectAll = () => {
    const updatedChunks = chunks.map(chunk => ({ ...chunk, selected: true }));
    onChunksChange(updatedChunks);
  };

  const clearSelection = () => {
    const updatedChunks = chunks.map(chunk => ({ ...chunk, selected: false }));
    onChunksChange(updatedChunks);
  };

  return (
    <Card className="fade-in">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-md font-semibold text-card-foreground">
            <Scissors className="mr-2 h-4 w-4 inline text-primary" />
            Select Chunks for Analysis
          </h3>
          <div className="text-sm text-muted-foreground">
            <span data-testid="text-chunk-count">{chunks.length}</span> chunks available
            {selectedCount > 0 && (
              <span className="ml-2">({selectedCount} selected)</span>
            )}
          </div>
        </div>
        
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {chunks.map((chunk) => (
            <div 
              key={chunk.id}
              className={`border border-border rounded-md p-2 cursor-pointer transition-all hover:bg-accent/50 ${
                chunk.selected ? 'bg-primary/5 border-primary' : ''
              }`}
              onClick={() => toggleChunk(chunk.id)}
              data-testid={`chunk-item-${chunk.id}`}
            >
              <div className="flex items-start gap-3">
                <Checkbox 
                  checked={chunk.selected}
                  onChange={() => toggleChunk(chunk.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-card-foreground">
                      {chunk.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {chunk.wordCount} words
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {chunk.preview}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={selectAll}
            data-testid="button-select-all"
          >
            Select All
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={clearSelection}
            data-testid="button-clear-selection"
          >
            Clear Selection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

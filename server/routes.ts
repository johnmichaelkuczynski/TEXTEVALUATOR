import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { analysisRequestSchema } from "@shared/schema";
import { LLMService } from "./services/llmService";
import { AnalysisService } from "./services/analysisService";
import { FileService } from "./services/fileService";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  const llmService = new LLMService();
  const analysisService = new AnalysisService(llmService);
  const fileService = new FileService();

  // Upload and parse file
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const result = await fileService.parseFile(req.file);
      res.json(result);
    } catch (error) {
      console.error("File upload error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: `Failed to process file: ${errorMessage}` });
    }
  });

  // Chunk text for large inputs
  app.post("/api/chunk", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      const chunks = analysisService.chunkText(text);
      res.json({ chunks });
    } catch (error) {
      console.error("Chunking error:", error);
      res.status(500).json({ error: "Failed to chunk text" });
    }
  });

  // Perform analysis with streaming
  app.post("/api/analyze", async (req, res) => {
    try {
      const request = analysisRequestSchema.parse(req.body);
      
      // Set headers for Server-Sent Events
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Stream analysis with progress updates
      const result = await analysisService.analyzeWithStreaming(request, (update) => {
        res.write(`data: ${JSON.stringify(update)}\n\n`);
      });

      // Send final result
      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Analysis error:", error);
      if (error instanceof Error && error.name === "ZodError") {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Invalid request format' })}\n\n`);
      } else {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        res.write(`data: ${JSON.stringify({ type: 'error', error: `Analysis failed: ${errorMessage}` })}\n\n`);
      }
      res.end();
    }
  });

  // Download results
  app.get("/api/download/:resultId", async (req, res) => {
    try {
      const { resultId } = req.params;
      const result = analysisService.getResult(resultId);
      
      if (!result) {
        return res.status(404).json({ error: "Result not found" });
      }

      const txtContent = analysisService.formatResultAsTxt(result);
      
      res.set({
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="analysis-${resultId}.txt"`
      });
      
      res.send(txtContent);
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Failed to download results" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

import { FileUpload } from "@shared/schema";
import * as mammoth from "mammoth";

export class FileService {
  async parseFile(file: Express.Multer.File): Promise<FileUpload> {
    const filename = file.originalname;
    const ext = filename.toLowerCase().split('.').pop();
    
    let content: string;
    
    try {
      switch (ext) {
        case 'txt':
          content = file.buffer.toString('utf-8');
          break;
        case 'doc':
        case 'docx':
          content = await this.parseDocx(file.buffer);
          break;
        case 'pdf':
          content = await this.parsePdf(file.buffer);
          break;
        default:
          throw new Error(`Unsupported file type: ${ext}`);
      }
      
      const wordCount = this.countWords(content);
      
      return {
        content: content.trim(),
        filename,
        wordCount
      };
    } catch (error) {
      console.error("File parsing error:", error);
      throw new Error(`Failed to parse ${ext} file: ${error.message}`);
    }
  }

  private async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = await import("pdf-parse");
      const data = await pdfParse.default(buffer);
      return data.text;
    } catch (error) {
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }
}

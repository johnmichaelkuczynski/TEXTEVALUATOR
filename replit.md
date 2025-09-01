# Text Analysis Application

## Overview

This is a comprehensive text analysis application designed to evaluate texts and determine cognitive capability, psychological characteristics, and psychopathology using a precise evaluation framework. The application provides six analysis modes across three categories (cognitive, psychological, psychopathological), each with short and long variants. It integrates multiple AI language models for analysis and features mandatory text chunking for documents over 1000 words with sequential processing and 10-second delays between chunks. The system uses an exact comprehensive intelligence evaluation framework that must be sent word-for-word to LLMs before any analysis.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Progress (August 31, 2025 - September 1, 2025)

### Complete Intelligence Assessment Protocol Successfully Implemented ✓
- **MAJOR BREAKTHROUGH**: Cognitive short analysis now "DRAMATICALLY BETTER" with proper scoring
- **CRITICAL PSYCHOLOGICAL FIX**: Psychological short analysis now uses proper psychological protocol questions ✓
- **CRITICAL PSYCHOPATHOLOGICAL FIX**: Psychopathological analysis now uses proper mental health assessment questions ✓
- **Complete Instruction Set**: All 28 questions (18 original + 10 additional) now sent to LLM verbatim
- **METAPOINT 1-6 Addendum**: Full addendum integrated into every analysis call
- **Phony Example Analysis**: Complete pseudo-intellectual example with detailed critique included
- **Positive Intelligence Examples**: Three exemplar passages showing true intellectual substance
- **Precise Scoring Calibration**: ≤65 for phony texts, ≥96 for intelligent texts now enforced

### Pure Passthrough System Achieved ✓
- **Zero Platform Interference**: System sends user's exact uploaded instructions word-for-word
- **No Hardcoded Logic**: Eliminated all scoring manipulation and template overrides
- **Authentic LLM Responses**: Real-time streaming of actual LLM analysis without modification
- **Sequential Processing**: Proper installment delivery with 10-second delays between chunks
- **METAPOINT 1-5 Integration**: All five critical metapoints now sent verbatim to every cognitive analysis to prevent grading mindset

### Current LLM Provider Performance
- **ZHI 4 (Perplexity)**: ✓ EXCELLENT - All modes working perfectly, sophisticated analysis, proper scoring (98/100 achieved)
- **ZHI 3 (DeepSeek)**: ✓ Much Better - Improved scoring (92/100 for intelligent text), user noted improvement
- **ZHI 2 (Anthropic)**: ⚠️ Scoring Issues - Still giving 89/100 to "genuinely intelligent" texts (major disconnect)
- **ZHI 1 (OpenAI)**: ❌ Blocked - Organization verification required despite $30k account credit

### Complete Intelligence Assessment Protocol Successfully Implemented ✓
- **MAJOR BREAKTHROUGH**: Cognitive short analysis now "DRAMATICALLY BETTER" with proper scoring
- **CRITICAL PSYCHOLOGICAL FIX**: Psychological short analysis now uses proper psychological protocol questions ✓
- **CRITICAL PSYCHOPATHOLOGICAL FIX**: Psychopathological analysis now uses proper mental health assessment questions ✓
- **Complete Instruction Set**: All 28 questions (18 original + 10 additional) now sent to LLM verbatim
- **METAPOINT 1-6 Addendum**: Full addendum integrated into every analysis call
- **Phony Example Analysis**: Complete pseudo-intellectual example with detailed critique included
- **Positive Intelligence Examples**: Three exemplar passages showing true intellectual substance
- **Precise Scoring Calibration**: ≤65 for phony texts, ≥96 for intelligent texts now enforced

### Real-Time Chunked Streaming System Successfully Implemented ✓
- **MAJOR SUCCESS**: All analysis modes now working - cognitive, meta-analysis, psychological, psychopathological
- **CHUNKED PROTOCOL DELIVERY**: Protocol sent in 2000-char chunks with 2-second processing delays
- **CHUNKED TEXT DELIVERY**: Text over 500 chars sent in 1000-char chunks with 1-second delays
- **REAL-TIME STREAMING DISPLAY**: Live analysis generation visible as LLM generates response
- **VISUAL PROGRESS INDICATORS**: Chunked delivery progress shown with processing status
- **NO MORE 10-MINUTE WAITS**: User sees immediate progress and real-time analysis generation
- **STREAMING TEXT WINDOW**: Dedicated display area with live cursor animation
- **PROTOCOL PROCESSING TIME**: LLM gets proper time to process each chunk before receiving next
- **USER CONFIRMED SUCCESS**: "OK, WORKS BETTER. COGNITIVE WORKS. META ANALYSIS WORKS. PSYCHOLOGICAL FUNCTION WORKS. PSYCHOPATHOLOGICAL WORKS."

### Critique & Regeneration Feature ✓
- **User Feedback Integration**: Critique box for analysis refinement
- **Improved Regeneration**: Addresses specific user concerns in revised analyses

### Technical Achievements
- **Advanced Brace-Matching Algorithm**: Handles complex nested JSON structures
- **Dual Response Parsing**: Primary JSON parsing with intelligent structured text fallback
- **Streaming Analysis**: Real-time progress updates for long-running analyses
- **Enhanced Token Limits**: Increased to 8000 tokens to prevent response truncation
- **Clean Response Display**: Eliminated all JSON artifacts from user-facing results

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Radix UI components with shadcn/ui design system
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints for file upload, text chunking, and analysis
- **File Processing**: Support for TXT, DOC, DOCX, and PDF file formats using mammoth and pdf-parse libraries
- **Error Handling**: Centralized error middleware with structured error responses

### Data Layer
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Connection**: Neon serverless PostgreSQL for cloud deployment
- **Schema Management**: Drizzle migrations for version control
- **Validation**: Zod schemas for runtime type checking across shared interfaces

### AI Integration
- **Multi-Provider Support**: Integration with four AI providers mapped as ZHI 1-4
  - ZHI 1: OpenAI (GPT-5)
  - ZHI 2: Anthropic (Claude Sonnet 4)
  - ZHI 3: DeepSeek
  - ZHI 4: Perplexity
- **Analysis Modes**: Six distinct analysis modes with specialized prompting
- **Text Processing**: Intelligent chunking for documents over 1000 words
- **Result Processing**: Structured parsing of AI responses with scoring systems
- **Critique & Regeneration**: Users can provide feedback on analyses to generate improved versions that address specific concerns

### File Processing System
- **Upload Handling**: Multer middleware for multipart file uploads
- **Format Support**: TXT, DOC, DOCX, and PDF parsing capabilities
- **Text Extraction**: Clean text extraction with word count metrics
- **Chunking Logic**: Automatic text segmentation with user selection interface

### Security and Validation
- **Input Validation**: Comprehensive Zod schemas for all API endpoints
- **File Validation**: Type checking and size limits for uploaded files
- **Error Boundaries**: React error boundaries with development overlays
- **CORS**: Configured for cross-origin requests in development

## External Dependencies

### AI Service Providers
- **OpenAI API**: Primary LLM provider for cognitive analysis
- **Anthropic API**: Advanced reasoning capabilities for psychological assessment
- **DeepSeek API**: Alternative analysis perspective
- **Perplexity API**: Research-enhanced analysis capabilities

### Database Services
- **Neon PostgreSQL**: Serverless PostgreSQL database hosting
- **Drizzle ORM**: Type-safe database operations and migrations

### File Processing Libraries
- **mammoth**: Microsoft Word document parsing
- **pdf-parse**: PDF text extraction
- **multer**: File upload handling

### UI and Development Tools
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first styling framework
- **TanStack Query**: Server state management
- **Vite**: Fast development and build tooling
- **Replit Integration**: Development environment optimization
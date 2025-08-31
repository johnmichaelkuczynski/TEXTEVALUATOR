interface QA {
  question: string;
  answer: string;
  score: number;
}

export function normalizeAssessment(rawResponse: string): { items: QA[]; overall: number; summary: string } {
  // Split the response into parts for processing
  const parts = rawResponse.split(/(?=IS IT INSIGHTFUL|DOES IT DEVELOP|IS THE ORGANIZATION)/i).filter(p => p.trim());
  
  const items: QA[] = parts.map((p, i) => {
    const q = (p.match(/^(.*?)(?:Answer\s*:|A\s*:)/i)?.[1] ?? `Q${i + 1}`).trim();
    const aRaw = (p.match(/(?:Answer\s*:|A\s*:)\s*([\s\S]*?)(?:\s*(?:Score|Rating)\s*[:=]\s*\d{1,3}|\s*$)/i)?.[1] ?? p);
    const a = aRaw.trim().replace(/^"+|"+$/g, "").replace(/\s*[:.]\s*$/,""); // remove trailing ":" or "."
    const s = numFrom(p); // per-item score only
    return { question: q, answer: a, score: s };
  });

  const scored = items.filter(i => Number.isFinite(i.score));
  const overall = scored.length
    ? Math.round(scored.reduce((t, x) => t + x.score, 0) / scored.length)
    : 0;

  // Extract summary from the beginning of the response
  const summaryMatch = rawResponse.match(/summary["\s]*:[\s]*["']([^"']+)["']/i);
  const summary = summaryMatch ? summaryMatch[1] : "Analysis completed";

  return { items, overall, summary };
}

function numFrom(seg: string) {
  const m = seg.match(/(?:Score|Rating)\s*[:=]\s*(\d{1,3})/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
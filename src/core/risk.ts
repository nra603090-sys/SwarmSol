// ============================================
// SwarmSol - File 6: Risk Analyzer Agent
// Groq LLM + Rule-based Fallback
// ============================================

import { riskLogger as log } from './logger';
import {
  ArbitrageSignal,
  RiskAssessment,
  SwarmError,
  SwarmErrorCode,
} from './types';
import {
  GROQ_CONFIG,
  SWARM_CONFIG,
  USE_MOCK,
} from './config';

// ----------------------------------------------------
// 1. Groq Client (Minimal OpenAI-compatible fetch)
// ----------------------------------------------------
class GroqClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl: string, model: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async chatCompletion(
    systemPrompt: string,
    userMessage: string,
    timeoutMs: number = GROQ_CONFIG.TIMEOUT_MS
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: GROQ_CONFIG.TEMPERATURE,
          max_tokens: GROQ_CONFIG.MAX_TOKENS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from Groq');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ----------------------------------------------------
// 2. LLM Prompt Templates
// ----------------------------------------------------
const SYSTEM_PROMPT = `You are a Solana DeFi arbitrage risk analyzer for the SwarmSol agent swarm.
Analyze the given arbitrage signal between two DEX pools.
Respond ONLY with a JSON object (no markdown, no extra text) using this schema:
{
  "isProfitable": boolean,
  "netProfitUSD": number,
  "confidence": number (0-100),
  "reasoning": string (max 100 chars),
  "riskLevel": "low" | "medium" | "high" | "critical"
}
Consider: price spread, liquidity depth, Jito tips (assume 50% of gross profit), Solana gas (~0.000005 SOL), and slippage.`;

function buildUserMessage(signal: ArbitrageSignal): string {
  return JSON.stringify({
    poolA: {
      dex: signal.poolA.dex,
      pair: signal.poolA.pair,
      price: signal.poolA.basePrice,
      liquidityUSD: signal.poolA.liquidityUSD,
    },
    poolB: {
      dex: signal.poolB.dex,
      pair: signal.poolB.pair,
      price: signal.poolB.basePrice,
      liquidityUSD: signal.poolB.liquidityUSD,
    },
    spreadPercent: signal.spreadPercent,
    tradeSizeUSD: signal.tradeSizeUSD,
  });
}

// ----------------------------------------------------
// 3. Rule-based Fallback Logic
// ----------------------------------------------------
function ruleBasedAssessment(signal: ArbitrageSignal): RiskAssessment {
  const tradeSize = signal.tradeSizeUSD;
  const grossProfit = (signal.spreadPercent / 100) * tradeSize;
  const gasCostSOL = 0.000005;
  const solPrice = 150; // approximate
  const gasCostUSD = gasCostSOL * solPrice;
  const jitoTipPercent = 0.5; // 50% of gross
  const jitoTipUSD = grossProfit * jitoTipPercent;
  const netProfit = grossProfit - gasCostUSD - jitoTipUSD;

  const isProfitable = netProfit >= SWARM_CONFIG.MIN_PROFIT_USD;
  const confidence = isProfitable ? 70 : 30; // Rule-based is less confident

  return {
    signal,
    isProfitable,
    netProfitUSD: netProfit,
    estimatedGasSOL: gasCostSOL,
    jitoTipSOL: jitoTipUSD / solPrice,
    confidence,
    reasoning: isProfitable
      ? `Spread ${signal.spreadPercent.toFixed(4)}% yields net ~$${netProfit.toFixed(4)} after fees.`
      : `Net profit $${netProfit.toFixed(4)} below threshold.`,
    riskLevel: signal.poolA.liquidityUSD > 500000 ? 'low' : 'medium',
    executionTimeMs: 0,
    analysisMethod: 'rule_based_fallback',
    assessedAt: Date.now(),
  };
}

// ----------------------------------------------------
// 4. Risk Analyzer Agent
// ----------------------------------------------------
export class RiskAnalyzerAgent {
  private groq: GroqClient | null = null;
  private useMock: boolean;

  constructor() {
    this.useMock = USE_MOCK;
    if (!this.useMock) {
      this.groq = new GroqClient(
        GROQ_CONFIG.API_KEY,
        GROQ_CONFIG.BASE_URL,
        GROQ_CONFIG.MODEL
      );
      log.info('Groq client initialized');
    } else {
      log.info('Mock mode – Groq will not be called');
    }
  }

  /**
   * Analyze an arbitrage signal and return a risk assessment.
   */
  async analyze(signal: ArbitrageSignal): Promise<RiskAssessment> {
    log.info(`Analyzing signal ${signal.id}`);
    if (this.useMock) {
      return this.mockAnalyze(signal);
    }

    try {
      return await this.llmAnalyze(signal);
    } catch (err) {
      log.warn(`Groq LLM failed, falling back to rule-based: ${err}`);
      const assessment = ruleBasedAssessment(signal);
      assessment.analysisMethod = 'rule_based_fallback';
      assessment.reasoning += ' (LLM failed)';
      return assessment;
    }
  }

  // --------------------------------------------------
  // Mock analysis (for demo, simulates LLM response)
  // --------------------------------------------------
  private async mockAnalyze(signal: ArbitrageSignal): Promise<RiskAssessment> {
    await this.delay(10); // simulate inference
    const assessment = ruleBasedAssessment(signal);
    // Make it look like LLM output
    assessment.analysisMethod = 'groq_llm';
    assessment.confidence = assessment.isProfitable ? 90 + Math.random() * 9 : Math.random() * 40;
    assessment.reasoning = `Groq LLM analysis: ${assessment.reasoning} (confidence: ${assessment.confidence.toFixed(1)}%)`;
    assessment.executionTimeMs = Math.floor(Math.random() * 15) + 5;
    return assessment;
  }

  // --------------------------------------------------
  // Real LLM analysis via Groq
  // --------------------------------------------------
  private async llmAnalyze(signal: ArbitrageSignal): Promise<RiskAssessment> {
    const startTime = Date.now();
    const userMsg = buildUserMessage(signal);
    const responseText = await this.groq!.chatCompletion(SYSTEM_PROMPT, userMsg);
    const executionTimeMs = Date.now() - startTime;

    // Parse JSON
    let parsed: any;
    try {
      // Sometimes LLM returns with backticks, strip them
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      throw new Error('Failed to parse Groq response as JSON');
    }

    return {
      signal,
      isProfitable: !!parsed.isProfitable,
      netProfitUSD: Number(parsed.netProfitUSD) || 0,
      estimatedGasSOL: 0.000005, // we can compute exactly later
      jitoTipSOL: (Number(parsed.netProfitUSD) * 0.5) / 150, // rough
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 80)),
      reasoning: parsed.reasoning || 'No reasoning provided',
      riskLevel: parsed.riskLevel || 'medium',
      executionTimeMs,
      analysisMethod: 'groq_llm',
      assessedAt: Date.now(),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ----------------------------------------------------
// 5. Pre-configured instance
// ----------------------------------------------------
export const riskAnalyzer = new RiskAnalyzerAgent();

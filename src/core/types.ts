// ============================================
// SwarmSol - File 2: TypeScript Type Definitions
// Strict typing for bug-free agent communication
// ============================================

import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// ============================================
// 1. DEX & Market Data Types
// ============================================

/** Supported Decentralized Exchanges */
export type DexName = 'raydium' | 'orca' | 'meteora';

/** Raw pool data fetched from DEX */
export interface PoolData {
  /** DEX identifier */
  dex: DexName;
  
  /** Trading pair (e.g., "SOL-USDC") */
  pair: string;
  
  /** Pool address on Solana */
  poolAddress: string;
  
  /** Base token mint address */
  baseMint: string;
  
  /** Quote token mint address */
  quoteMint: string;
  
  /** Current base token price in USD */
  basePrice: number;
  
  /** Current quote token price in USD */
  quotePrice: number;
  
  /** Total Value Locked in USD */
  liquidityUSD: number;
  
  /** 24-hour trading volume in USD */
  volume24h: number;
  
  /** Trading fee in decimal (0.003 = 0.3%) */
  fee: number;
  
  /** Unix timestamp of data fetch */
  timestamp: number;
}

/** Price update event emitted by Scout Agents */
export interface PriceUpdateEvent {
  pool: PoolData;
  previousPrice: number;
  priceChangePercent: number;
  timestamp: number;
}

// ============================================
// 2. Arbitrage Signal Types
// ============================================

/** Detected arbitrage opportunity between two pools */
export interface ArbitrageSignal {
  /** Unique signal ID for tracking */
  id: string;
  
  /** Pool to BUY from (cheaper) */
  poolA: PoolData;
  
  /** Pool to SELL to (more expensive) */
  poolB: PoolData;
  
  /** Price spread percentage */
  spreadPercent: number;
  
  /** Gross profit before fees (in USD) */
  grossProfitUSD: number;
  
  /** Trade size in USD */
  tradeSizeUSD: number;
  
  /** Unix timestamp when signal was detected */
  detectedAt: number;
  
  /** Time-to-live in ms (signal expires after this) */
  ttlMs: number;
  
  /** Whether this signal has been acted upon */
  status: 'pending' | 'analyzing' | 'executing' | 'completed' | 'expired' | 'rejected';
}

// ============================================
// 3. Risk Assessment Types (Groq LLM Output)
// ============================================

/** Risk assessment result from Groq LLM or rule-based fallback */
export interface RiskAssessment {
  /** The original signal being assessed */
  signal: ArbitrageSignal;
  
  /** Whether the trade is profitable after all costs */
  isProfitable: boolean;
  
  /** Net profit after gas, fees, and Jito tip (USD) */
  netProfitUSD: number;
  
  /** Estimated total gas cost (SOL) */
  estimatedGasSOL: number;
  
  /** Jito tip amount (SOL) */
  jitoTipSOL: number;
  
  /** LLM confidence score (0-100) */
  confidence: number;
  
  /** Human-readable reasoning from LLM */
  reasoning: string;
  
  /** Risk level based on volatility and liquidity */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Total inference time in milliseconds */
  executionTimeMs: number;
  
  /** Whether LLM or rule-based fallback was used */
  analysisMethod: 'groq_llm' | 'rule_based_fallback';
  
  /** Unix timestamp of assessment */
  assessedAt: number;
}

// ============================================
// 4. Execution & Jito Bundle Types
// ============================================

/** Single leg of an arbitrage (buy or sell) */
export interface TradeLeg {
  /** Buy or Sell */
  action: 'buy' | 'sell';
  
  /** Target DEX */
  dex: DexName;
  
  /** Token mint to trade */
  tokenMint: string;
  
  /** Amount in smallest unit (lamports) */
  amount: number;
  
  /** Expected price */
  expectedPrice: number;
  
  /** Maximum slippage tolerance (basis points) */
  maxSlippageBps: number;
}

/** Jito Bundle payload for atomic execution */
export interface JitoBundlePayload {
  /** Unique bundle ID */
  bundleId: string;
  
  /** Array of base58-encoded serialized transactions */
  transactions: string[];
  
  /** Trade legs metadata (for logging) */
  legs: TradeLeg[];
  
  /** Jito tip in lamports */
  tipLamports: number;
  
  /** Jito tip account */
  tipAccount: string;
  
  /** Whether simulation was performed */
  simulated: boolean;
  
  /** Simulation result */
  simulationSuccess: boolean;
  
  /** Expected profit if successful */
  expectedProfitUSD: number;
}

/** Result after bundle submission */
export interface BundleResult {
  /** Bundle ID */
  bundleId: string;
  
  /** Whether the bundle was accepted */
  accepted: boolean;
  
  /** Transaction signature(s) if confirmed */
  txSignatures: string[];
  
  /** Block slot number */
  slot?: number;
  
  /** Actual profit realized (USD) */
  realizedProfitUSD?: number;
  
  /** Error message if failed */
  error?: string;
  
  /** Total execution time from signal to confirmation (ms) */
  totalLatencyMs: number;
}

// ============================================
// 5. Agent Status & Health Types
// ============================================

/** Status of an individual agent */
export interface AgentStatus {
  /** Agent identifier */
  agentId: string;
  
  /** Agent type */
  agentType: 'scout' | 'risk_analyzer' | 'executor';
  
  /** Current state */
  state: 'idle' | 'running' | 'error' | 'stopped';
  
  /** Number of successful operations */
  successCount: number;
  
  /** Number of failed operations */
  failureCount: number;
  
  /** Last activity timestamp */
  lastActiveAt: number;
  
  /** Last error message if any */
  lastError?: string;
  
  /** Average operation latency (ms) */
  avgLatencyMs: number;
}

// ============================================
// 6. Swarm Configuration Types
// ============================================

/** Complete swarm configuration */
export interface SwarmConfig {
  // Solana RPC
  rpcUrl: string;
  backupRpcUrls: string[];
  wssUrl: string;
  
  // Jito
  jitoBlockEngineUrl: string;
  jitoTipAccount: string;
  jitoTipPercent: number;
  
  // Groq LLM
  groqApiKey: string;
  groqModel: string;
  
  // Strategy
  minProfitThresholdUSD: number;
  minSpreadPercent: number;
  tradeSizeUSD: number;
  maxSlippageBps: number;
  
  // Operations
  scanIntervalMs: number;
  supportedDexs: DexName[];
  minLiquidityUSD: number;
  
  // Environment
  useMock: boolean;
}

/** Swarm statistics for monitoring */
export interface SwarmStats {
  /** Total signals detected */
  totalSignals: number;
  
  /** Total bundles submitted */
  totalBundles: number;
  
  /** Successful bundles */
  successfulBundles: number;
  
  /** Failed bundles */
  failedBundles: number;
  
  /** Total profit in USD */
  totalProfitUSD: number;
  
  /** Uptime in seconds */
  uptimeSeconds: number;
  
  /** Agent statuses */
  agents: AgentStatus[];
  
  /** Last updated timestamp */
  lastUpdated: number;
}

// ============================================
// 7. Error Types
// ============================================

/** Custom error class for SwarmSol */
export class SwarmError extends Error {
  constructor(
    message: string,
    public code: SwarmErrorCode,
    public agentId?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}

/** Error codes for structured error handling */
export enum SwarmErrorCode {
  // Connection errors
  RPC_CONNECTION_FAILED = 'RPC_CONNECTION_FAILED',
  RPC_RATE_LIMITED = 'RPC_RATE_LIMITED',
  JITO_CONNECTION_FAILED = 'JITO_CONNECTION_FAILED',
  
  // Scout errors
  POOL_DATA_FETCH_FAILED = 'POOL_DATA_FETCH_FAILED',
  PRICE_FEED_STALE = 'PRICE_FEED_STALE',
  
  // Risk errors
  GROQ_API_ERROR = 'GROQ_API_ERROR',
  GROQ_TIMEOUT = 'GROQ_TIMEOUT',
  RISK_ASSESSMENT_INVALID = 'RISK_ASSESSMENT_INVALID',
  
  // Execution errors
  BUNDLE_SIMULATION_FAILED = 'BUNDLE_SIMULATION_FAILED',
  BUNDLE_SUBMISSION_FAILED = 'BUNDLE_SUBMISSION_FAILED',
  BUNDLE_REJECTED = 'BUNDLE_REJECTED',
  TRANSACTION_EXPIRED = 'TRANSACTION_EXPIRED',
  
  // Swarm errors
  SWARM_LOCK_TIMEOUT = 'SWARM_LOCK_TIMEOUT',
  AGENT_CRASHED = 'AGENT_CRASHED',
  
  // General
  INVALID_CONFIG = 'INVALID_CONFIG',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// ============================================
// 8. Event Bus Types (RxJS)
// ============================================

/** All possible events in the Swarm event bus */
export interface SwarmEvents {
  // Price updates
  priceUpdate: PriceUpdateEvent;
  
  // Signal detection
  signalDetected: ArbitrageSignal;
  
  // Risk analysis
  riskAssessed: RiskAssessment;
  
  // Execution
  bundleCreated: JitoBundlePayload;
  bundleResult: BundleResult;
  
  // Agent lifecycle
  agentStatusChanged: AgentStatus;
  
  // Errors
  error: SwarmError;
  
  // Swarm lifecycle
  swarmStarted: { timestamp: number };
  swarmStopped: { timestamp: number; reason: string };
  swarmStats: SwarmStats;
}

/** Event type keys */
export type SwarmEventName = keyof SwarmEvents;

// ============================================
// 9. Utility Types
// ============================================

/** Generic operation result (Rust-style Result pattern) */
export type Result<T, E = SwarmError> = 
  | { success: true; data: T }
  | { success: false; error: E };

/** Performance metrics for any operation */
export interface PerformanceMetrics {
  operationName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// ============================================
// 10. Export all types as namespace (optional)
// ============================================


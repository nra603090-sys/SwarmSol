// ============================================
// SwarmSol - File 1: Config & Constants
// Central Configuration Hub for Solana Agents
// ============================================

import dotenv from 'dotenv';
import { SwarmConfig } from './types';

// Load Environment Variables
dotenv.config();

/**
 * Validation Helper: Ensures a required ENV variable exists
 * Terminates the process if a critical key is missing
 */
function requireEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${key}. Check your .env file!`
    );
  }
  return value;
}

// ============================================
// Solana RPC & Network Constants
// ============================================
export const SOLANA_CONFIG = {
  // Primary RPC (Helius recommended for low latency)
  RPC_URL: requireEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  
  // Backup RPCs for failover (Optional)
  BACKUP_RPC_URLS: process.env.BACKUP_RPC_URLS?.split(',') || [
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
  ],

  // WebSocket endpoint for real-time data
  WSS_URL: requireEnv('SOLANA_WSS_URL', 'wss://api.mainnet-beta.solana.com'),

  // Commitment level for transactions
  COMMITMENT: 'confirmed' as const,

  // Max retries for RPC calls
  MAX_RETRIES: 3,

  // Rate limiting (requests per second)
  MAX_RPS: 10,
};

// ============================================
// Jito Block Engine Constants
// ============================================
export const JITO_CONFIG = {
  // Jito Block Engine URL (Mainnet)
  BLOCK_ENGINE_URL: requireEnv(
    'JITO_BLOCK_ENGINE_URL',
    'https://mainnet.block-engine.jito.wtf'
  ),

  // Jito Tip Account (Official Mainnet)
  TIP_ACCOUNT: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',

  // Additional tip accounts for redundancy
  TIP_ACCOUNTS: [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4eVV8bD44Pvwucfq2B4Lh6B',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf7uEMzpY6YjR4GzRZR4K',
  ],

  // Dynamic Tip Calculation
  MIN_TIP_LAMPORTS: 1000, // 0.000001 SOL
  MAX_TIP_LAMPORTS: 1000000, // 0.001 SOL
  TIP_PERCENT_OF_PROFIT: 50, // Give 50% of net profit as tip

  // Bundle Settings
  MAX_BUNDLE_SIZE: 4, // Max transactions per bundle
  BUNDLE_TIMEOUT_MS: 15000, // 15 seconds timeout
};

// ============================================
// Groq AI / LLM Constants
// ============================================
export const GROQ_CONFIG = {
  API_KEY: requireEnv('GROQ_API_KEY', 'mock-key-for-demo'),
  
  // Groq API Endpoint (OpenAI Compatible)
  BASE_URL: 'https://api.groq.com/openai/v1',

  // Model Selection
  // Options: llama3-70b-8192, llama3-8b-8192, mixtral-8x7b-32768
  MODEL: requireEnv('GROQ_MODEL', 'llama3-70b-8192'),

  // Inference Settings
  TEMPERATURE: 0.1, // Low temp for deterministic financial decisions
  MAX_TOKENS: 200, // Keep responses short for low latency
  TIMEOUT_MS: 500, // 500ms timeout (Groq is fast, ~10-20ms typical)

  // Fallback behavior
  FALLBACK_TO_RULE_BASED: true, // If LLM fails, use rule-based logic
};

// ============================================
// DEX & Market Constants
// ============================================
export const DEX_CONFIG = {
  // Monitored DEXs
  SUPPORTED_DEXS: ['raydium', 'orca', 'meteora'] as const,

  // Default trading pairs
  DEFAULT_PAIRS: ['SOL-USDC', 'BONK-USDC', 'JUP-USDC'],

  // Raydium Program IDs
  RAYDIUM_AMM_PROGRAM_ID: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',

  // Orca Program IDs
  ORCA_WHIRLPOOL_PROGRAM_ID: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',

  // Minimum pool liquidity to consider (avoid low-liquidity traps)
  MIN_LIQUIDITY_USD: 50000,

  // Slippage Settings
  MAX_SLIPPAGE_BPS: 50, // 0.5% max slippage
};

// ============================================
// Swarm Strategy Parameters
// ============================================
export const SWARM_CONFIG = {
  // Profitability Thresholds
  MIN_PROFIT_USD: 0.05, // Minimum $0.05 profit per trade
  MIN_SPREAD_PERCENT: 0.05, // Minimum 0.05% price spread

  // Trade Size (Fixed for v1, dynamic in v2)
  TRADE_SIZE_USD: 100, // $100 per arbitrage

  // Scanning Interval
  SCAN_INTERVAL_MS: 2000, // Scan every 2 seconds

  // Agent Counts
  SCOUT_COUNT: 3, // Number of parallel scout agents

  // Execution Lock
  LOCK_TIMEOUT_MS: 10000, // Max time to hold execution lock

  // Health Checks
  HEALTH_CHECK_INTERVAL_MS: 30000, // 30 seconds
};

// ============================================
// Environment Detection
// ============================================
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const IS_DEVELOPMENT = !IS_PRODUCTION;
export const USE_MOCK = process.env.USE_MOCK === 'true' || IS_DEVELOPMENT;

// ============================================
// Central Config Builder Function
// ============================================
export function buildSwarmConfig(overrides?: Partial<SwarmConfig>): SwarmConfig {
  return {
    rpcUrl: SOLANA_CONFIG.RPC_URL,
    backupRpcUrls: SOLANA_CONFIG.BACKUP_RPC_URLS,
    wssUrl: SOLANA_CONFIG.WSS_URL,
    jitoBlockEngineUrl: JITO_CONFIG.BLOCK_ENGINE_URL,
    jitoTipAccount: JITO_CONFIG.TIP_ACCOUNT,
    jitoTipPercent: JITO_CONFIG.TIP_PERCENT_OF_PROFIT,
    groqApiKey: GROQ_CONFIG.API_KEY,
    groqModel: GROQ_CONFIG.MODEL,
    minProfitThresholdUSD: SWARM_CONFIG.MIN_PROFIT_USD,
    minSpreadPercent: SWARM_CONFIG.MIN_SPREAD_PERCENT,
    tradeSizeUSD: SWARM_CONFIG.TRADE_SIZE_USD,
    scanIntervalMs: SWARM_CONFIG.SCAN_INTERVAL_MS,
    maxSlippageBps: DEX_CONFIG.MAX_SLIPPAGE_BPS,
    supportedDexs: [...DEX_CONFIG.SUPPORTED_DEXS],
    minLiquidityUSD: DEX_CONFIG.MIN_LIQUIDITY_USD,
    useMock: USE_MOCK,
    ...overrides,
  };
}

// ============================================
// Console Banner (Displayed on startup)
// ============================================
export function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════╗
║         🐝 SwarmSol - AI Agent Swarm              ║
║   Atomically Bundled Arbitrage on Solana          ║
║   Powered by: Jito Bundles + Groq LLM             ║
║   Grant: Superteam Agentic Engineering ($200)     ║
║   Environment: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}                         ║
╚══════════════════════════════════════════════════╝
  `);
}

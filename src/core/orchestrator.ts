// ============================================
// SwarmSol - File 8: Swarm Orchestrator
// Main Coordinator + Entry Point
// ============================================

import { orchestratorLogger as log } from './logger';
import { ScoutAgent, createScout } from './scout';
import { RiskAnalyzerAgent } from './risk';
import { ExecutorAgent } from './executor';
import { ConnectionManager, initializeConnections } from './connection';
import {
  ArbitrageSignal,
  RiskAssessment,
  BundleResult,
  AgentStatus,
  SwarmStats,
  SwarmError,
  SwarmErrorCode,
  DexName,
} from './types';
import {
  SWARM_CONFIG,
  DEX_CONFIG,
  printBanner,
  buildSwarmConfig,
} from './config';
import { PublicKey } from '@solana/web3.js';

// ----------------------------------------------------
// 1. Swarm Orchestrator Class
// ----------------------------------------------------
export class SwarmOrchestrator {
  private scouts: ScoutAgent[] = [];
  private riskAnalyzer: RiskAnalyzerAgent;
  private executor: ExecutorAgent;
  private isLocked: boolean = false;
  private lockTimeout: NodeJS.Timeout | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private stats: SwarmStats;
  private startTime: number = 0;

  constructor() {
    this.riskAnalyzer = new RiskAnalyzerAgent();
    this.executor = new ExecutorAgent();
    this.stats = this.initializeStats();
  }

  /**
   * Initialize the swarm with scout agents
   */
  async initialize(
    dexList: DexName[] = DEX_CONFIG.SUPPORTED_DEXS as unknown as DexName[],
    pairs: string[] = DEX_CONFIG.DEFAULT_PAIRS
  ): Promise<void> {
    printBanner();
    log.info('Initializing SwarmSol...');

    // Initialize connections (RPC health check)
    await initializeConnections();

    // Create scouts for each DEX
    this.scouts = [];
    let scoutCount = 0;
    for (const dex of dexList) {
      const numScouts = dex === 'raydium' ? 2 : 1; // 2 for Raydium, 1 for others
      for (let i = 0; i < numScouts; i++) {
        scoutCount++;
        this.scouts.push(createScout(`scout-${dex}-${scoutCount}`, dex));
      }
    }

    log.info(`${this.scouts.length} scouts deployed across ${dexList.length} DEXs`);
    log.info(`Monitoring pairs: ${pairs.join(', ')}`);
    log.info(`Scan interval: ${SWARM_CONFIG.SCAN_INTERVAL_MS}ms`);
    log.info(`Min profit threshold: $${SWARM_CONFIG.MIN_PROFIT_USD}`);
  }

  /**
   * Start the main swarm loop
   */
  start(pair: string = 'SOL-USDC'): void {
    this.startTime = Date.now();
    log.info(`🚀 Swarm loop STARTED for ${pair}`);

    this.intervalId = setInterval(async () => {
      await this.tick(pair);
    }, SWARM_CONFIG.SCAN_INTERVAL_MS);
  }

  /**
   * Stop the swarm gracefully
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
    log.info('🛑 Swarm loop STOPPED');
    this.printStats();
  }

  /**
   * Single iteration of the swarm loop
   */
  private async tick(pair: string): Promise<void> {
    // Prevent overlapping executions
    if (this.isLocked) {
      log.debug('⏳ Swarm locked, skipping tick');
      return;
    }

    try {
      // === PHASE 1: Scout (Parallel) ===
      log.info('\n🔍 === Scout Phase ===');
      const allPools = await this.scoutPhase(pair);
      if (allPools.length < 2) {
        log.debug('Not enough pools found, skipping');
        return;
      }

      // === PHASE 2: Signal Detection ===
      log.info('🎯 === Signal Detection ===');
      const signal = this.detectSignal(allPools);
      if (!signal) {
        log.debug('No arbitrage signal detected');
        return;
      }
      this.stats.totalSignals++;
      log.info(
        `💰 Spread: ${signal.poolA.dex}→${signal.poolB.dex} | ${signal.spreadPercent.toFixed(4)}% | Profit: $${signal.grossProfitUSD.toFixed(4)}`
      );

      // === PHASE 3: Risk Analysis ===
      log.info('🧠 === Risk Analysis ===');
      const assessment = await this.riskPhase(signal);
      this.logAssessment(assessment);

      if (!assessment.isProfitable) {
        log.info('Signal rejected – not profitable');
        return;
      }

      // === PHASE 4: Execute ===
      log.info('⚔️ === Execution Phase ===');
      await this.executePhase(assessment);

    } catch (err: any) {
      log.error(`Swarm tick error: ${err.message}`);
    }
  }

  // --------------------------------------------------
  // Phase 1: Scout – Fetch pools from all agents
  // --------------------------------------------------
  private async scoutPhase(pair: string) {
    const results = await Promise.allSettled(
      this.scouts.map((scout) => scout.scanPools(pair))
    );

    const allPools = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPools.push(...result.value);
      } else {
        log.warn(`Scout failed: ${result.reason}`);
      }
    }

    log.info(`Scouts returned ${allPools.length} total pools`);
    return allPools;
  }

  // --------------------------------------------------
  // Phase 2: Signal Detection
  // --------------------------------------------------
  private detectSignal(pools: import('./2_types').PoolData[]): ArbitrageSignal | null {
    if (pools.length < 2) return null;

    // Sort by price ascending
    const sorted = [...pools].sort((a, b) => a.basePrice - b.basePrice);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];

    // Must be different DEXs
    if (cheapest.dex === mostExpensive.dex) return null;

    // Calculate spread
    const spread = ((mostExpensive.basePrice - cheapest.basePrice) / cheapest.basePrice) * 100;
    if (spread <= SWARM_CONFIG.MIN_SPREAD_PERCENT) return null;

    const grossProfit = (spread / 100) * SWARM_CONFIG.TRADE_SIZE_USD;

    return {
      id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      poolA: cheapest,    // Buy here
      poolB: mostExpensive, // Sell here
      spreadPercent: spread,
      grossProfitUSD: grossProfit,
      tradeSizeUSD: SWARM_CONFIG.TRADE_SIZE_USD,
      detectedAt: Date.now(),
      ttlMs: 5000, // Signal expires after 5 seconds
      status: 'pending',
    };
  }

  // --------------------------------------------------
  // Phase 3: Risk Analysis
  // --------------------------------------------------
  private async riskPhase(signal: ArbitrageSignal): Promise<RiskAssessment> {
    signal.status = 'analyzing';
    const assessment = await this.riskAnalyzer.analyze(signal);
    signal.status = assessment.isProfitable ? 'executing' : 'rejected';
    return assessment;
  }

  // --------------------------------------------------
  // Phase 4: Execute
  // --------------------------------------------------
  private async executePhase(assessment: RiskAssessment): Promise<void> {
    // Lock the swarm
    this.acquireLock();

    try {
      // Use a dummy public key for demo; in production, use real wallet
      const userPublicKey = new PublicKey(
        '11111111111111111111111111111111111111111' // placeholder
      );

      const result = await this.executor.execute(assessment, userPublicKey);
      this.stats.totalBundles++;

      if (result && result.accepted) {
        this.stats.successfulBundles++;
        this.stats.totalProfitUSD += assessment.netProfitUSD;
        log.info(`🏆 ARBITRAGE SUCCESS! Net: $${assessment.netProfitUSD.toFixed(4)}`);
      } else {
        this.stats.failedBundles++;
        log.warn(`❌ Bundle failed/rejected: ${result?.error || 'Unknown'}`);
      }
    } catch (err: any) {
      this.stats.failedBundles++;
      log.error(`Execution error: ${err.message}`);
    } finally {
      this.releaseLock();
    }
  }

  // --------------------------------------------------
  // Lock Management
  // --------------------------------------------------
  private acquireLock(): void {
    this.isLocked = true;
    this.lockTimeout = setTimeout(() => {
      log.warn('Lock timeout – force releasing');
      this.releaseLock();
    }, SWARM_CONFIG.LOCK_TIMEOUT_MS);
  }

  private releaseLock(): void {
    this.isLocked = false;
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
  }

  // --------------------------------------------------
  // Stats & Logging
  // --------------------------------------------------
  private initializeStats(): SwarmStats {
    return {
      totalSignals: 0,
      totalBundles: 0,
      successfulBundles: 0,
      failedBundles: 0,
      totalProfitUSD: 0,
      uptimeSeconds: 0,
      agents: [],
      lastUpdated: Date.now(),
    };
  }

  private logAssessment(assessment: RiskAssessment): void {
    const emoji = assessment.isProfitable ? '✅' : '❌';
    log.info(
      `${emoji} Risk: ${assessment.isProfitable ? 'GO' : 'NO-GO'} | Net: $${assessment.netProfitUSD.toFixed(4)} | Confidence: ${assessment.confidence.toFixed(1)}% | Time: ${assessment.executionTimeMs}ms`
    );
    if (assessment.reasoning) {
      log.debug(`   Reason: ${assessment.reasoning}`);
    }
  }

  private printStats(): void {
    const uptime = (Date.now() - this.startTime) / 1000;
    log.info('\n📊 === Swarm Statistics ===');
    log.info(`   Uptime: ${uptime.toFixed(0)}s`);
    log.info(`   Signals: ${this.stats.totalSignals}`);
    log.info(`   Bundles: ${this.stats.totalBundles} (${this.stats.successfulBundles} success, ${this.stats.failedBundles} failed)`);
    log.info(`   Total Profit: $${this.stats.totalProfitUSD.toFixed(4)}`);
  }

  getStats(): SwarmStats {
    this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.stats.lastUpdated = Date.now();
    return this.stats;
  }
}

// ----------------------------------------------------
// 2. Entry Point
// ----------------------------------------------------
async function main() {
  const swarm = new SwarmOrchestrator();

  // Graceful shutdown
  process.on('SIGINT', () => {
    log.info('\nReceived SIGINT – shutting down...');
    swarm.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log.info('Received SIGTERM – shutting down...');
    swarm.stop();
    process.exit(0);
  });

  // Initialize and start
  await swarm.initialize();
  swarm.start('SOL-USDC');
}

// Run if called directly
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
  }

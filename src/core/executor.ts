// ============================================
// SwarmSol - File 7: Executor Agent
// Jito Bundle Builder & Atomic Execution
// ============================================

import {
  Connection,
  Transaction,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { ConnectionManager } from './connection';
import { executorLogger as log } from './logger';
import {
  ArbitrageSignal,
  RiskAssessment,
  TradeLeg,
  JitoBundlePayload,
  BundleResult,
  SwarmError,
  SwarmErrorCode,
  DexName,
} from './types';
import {
  JITO_CONFIG,
  SOLANA_CONFIG,
  DEX_CONFIG,
  SWARM_CONFIG,
  USE_MOCK,
} from './config';
import * as bs58 from 'bs58';

// ----------------------------------------------------
// 1. Types
// ----------------------------------------------------
interface BuildTransactionParams {
  action: 'buy' | 'sell';
  dex: DexName;
  tokenMint: string;
  amount: number; // in smallest units (lamports for SOL)
  maxSlippageBps: number;
}

// ----------------------------------------------------
// 2. Transaction Builder
// ----------------------------------------------------
function buildSwapInstruction(
  params: BuildTransactionParams,
  userPublicKey: PublicKey,
  poolAddress: PublicKey
): Transaction {
  const tx = new Transaction();

  // In production, this would create actual DEX swap instructions:
  // - Raydium: raydiumAmm.swap()
  // - Orca: whirlpool.swap()
  // For now, we simulate with a memo or dummy transfer to show the pattern

  // Add a minimal SOL transfer to self as dummy (demonstrates TX structure)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: userPublicKey,
      toPubkey: userPublicKey,
      lamports: 1, // 1 lamport just for structure
    })
  );

  // Add compute budget for priority
  tx.recentBlockhash = ''; // Will be set before sending
  tx.feePayer = userPublicKey;

  return tx;
}

// ----------------------------------------------------
// 3. Executor Agent Class
// ----------------------------------------------------
export class ExecutorAgent {
  private agentId: string;
  private userKeypair: { publicKey: PublicKey; secretKey: Uint8Array } | null = null;

  constructor(agentId: string = 'executor-1') {
    this.agentId = agentId;
    log.info(`Executor ${this.agentId} initialized`);
  }

  /**
   * Set user wallet for signing transactions
   * In production, use proper key management (never hardcode)
   */
  setWallet(secretKeyBase58: string): void {
    const secretKey = bs58.decode(secretKeyBase58);
    const publicKey = new PublicKey(
      // Derive from secretKey - simplified
      bs58.encode(secretKey.slice(0, 32)) 
    );
    this.userKeypair = { publicKey, secretKey };
    log.info(`Wallet set: ${publicKey.toBase58().slice(0, 8)}...`);
  }

  /**
   * Main execution method: Build & send Jito bundle
   */
  async execute(
    assessment: RiskAssessment,
    userPublicKey: PublicKey
  ): Promise<BundleResult | null> {
    if (!assessment.isProfitable) {
      log.info(`Skipping unprofitable signal`);
      return null;
    }

    const signal = assessment.signal;
    log.info(`⚡ Executing arbitrage: ${signal.poolA.dex} → ${signal.poolB.dex}`);

    try {
      // Step 1: Build trade legs
      const legs = this.buildTradeLegs(signal, userPublicKey);
      log.debug(`Built ${legs.length} trade legs`);

      // Step 2: Build transactions for each leg
      const transactions = await this.buildTransactions(legs, userPublicKey);
      log.debug(`Built ${transactions.length} transactions`);

      // Step 3: Calculate Jito tip
      const tipLamports = this.calculateTip(assessment);
      log.info(`Jito tip: ${(tipLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

      // Step 4: Create bundle payload
      const bundlePayload = await this.createBundle(transactions, tipLamports);

      // Step 5: Simulate bundle (safety check)
      const simResult = await this.simulateBundle(bundlePayload);
      if (!simResult) {
        log.warn(`Bundle simulation failed – aborting`);
        return {
          bundleId: bundlePayload.bundleId,
          accepted: false,
          txSignatures: [],
          error: 'Simulation failed',
          totalLatencyMs: 0,
        };
      }

      // Step 6: Send bundle to Jito
      const result = await this.sendBundle(bundlePayload);
      log.info(`✅ Bundle result: ${result.accepted ? 'ACCEPTED' : 'REJECTED'}`);
      
      return result;

    } catch (err: any) {
      log.error(`Execution failed: ${err.message}`);
      throw new SwarmError(
        `Execution error: ${err.message}`,
        SwarmErrorCode.BUNDLE_SUBMISSION_FAILED,
        this.agentId
      );
    }
  }

  // --------------------------------------------------
  // Private: Build trade legs from signal
  // --------------------------------------------------
  private buildTradeLegs(
    signal: ArbitrageSignal,
    userPublicKey: PublicKey
  ): TradeLeg[] {
    const amountLamports = Math.floor(
      (signal.tradeSizeUSD / signal.poolA.basePrice) * LAMPORTS_PER_SOL
    );

    return [
      {
        action: 'buy',
        dex: signal.poolA.dex,
        tokenMint: signal.poolA.baseMint,
        amount: amountLamports,
        expectedPrice: signal.poolA.basePrice,
        maxSlippageBps: DEX_CONFIG.MAX_SLIPPAGE_BPS,
      },
      {
        action: 'sell',
        dex: signal.poolB.dex,
        tokenMint: signal.poolB.baseMint,
        amount: amountLamports,
        expectedPrice: signal.poolB.basePrice,
        maxSlippageBps: DEX_CONFIG.MAX_SLIPPAGE_BPS,
      },
    ];
  }

  // --------------------------------------------------
  // Private: Build Solana transactions
  // --------------------------------------------------
  private async buildTransactions(
    legs: TradeLeg[],
    userPublicKey: PublicKey
  ): Promise<Transaction[]> {
    const conn = ConnectionManager.getInstance().getConnection();
    const { blockhash } = await conn.getLatestBlockhash(SOLANA_CONFIG.COMMITMENT);

    return legs.map((leg) => {
      const poolAddress = new PublicKey(leg.tokenMint); // Simplified
      const tx = buildSwapInstruction(
        { action: leg.action, dex: leg.dex, tokenMint: leg.tokenMint, amount: leg.amount, maxSlippageBps: leg.maxSlippageBps },
        userPublicKey,
        poolAddress
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = userPublicKey;
      return tx;
    });
  }

  // --------------------------------------------------
  // Private: Calculate Jito tip dynamically
  // --------------------------------------------------
  private calculateTip(assessment: RiskAssessment): number {
    const profitLamports = Math.floor(
      assessment.netProfitUSD * LAMPORTS_PER_SOL
    );
    const tipPercent = JITO_CONFIG.TIP_PERCENT_OF_PROFIT / 100;
    const calculatedTip = Math.floor(profitLamports * tipPercent);
    
    // Clamp between min and max
    return Math.max(
      JITO_CONFIG.MIN_TIP_LAMPORTS,
      Math.min(JITO_CONFIG.MAX_TIP_LAMPORTS, calculatedTip)
    );
  }

  // --------------------------------------------------
  // Private: Create Jito bundle payload
  // --------------------------------------------------
  private async createBundle(
    transactions: Transaction[],
    tipLamports: number
  ): Promise<JitoBundlePayload> {
    // Serialize transactions to base58
    const serializedTxs = transactions.map((tx) =>
      bs58.encode(tx.serialize({ requireAllSignatures: false }))
    );

    const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return {
      bundleId,
      transactions: serializedTxs,
      legs: [], // We'll keep empty for now; can fill later
      tipLamports,
      tipAccount: JITO_CONFIG.TIP_ACCOUNT,
      simulated: false,
      simulationSuccess: false,
      expectedProfitUSD: 0,
    };
  }

  // --------------------------------------------------
  // Private: Simulate bundle before sending
  // --------------------------------------------------
  private async simulateBundle(bundle: JitoBundlePayload): Promise<boolean> {
    if (USE_MOCK) {
      log.info('Mock simulation – assuming success');
      await this.delay(15);
      bundle.simulated = true;
      bundle.simulationSuccess = true;
      return true;
    }

    try {
      log.info('Simulating bundle with Jito...');
      const jito = ConnectionManager.getInstance().getJitoClient();
      
      // Convert base58 strings to Uint8Array
      const txBuffers = bundle.transactions.map((tx) => bs58.decode(tx));
      
      const success = await jito.simulateBundle(txBuffers);
      bundle.simulated = true;
      bundle.simulationSuccess = success;
      
      if (!success) {
        log.warn('Simulation indicated failure');
      }
      
      return success;
    } catch (err: any) {
      log.error(`Simulation error: ${err.message}`);
      bundle.simulated = true;
      bundle.simulationSuccess = false;
      return false;
    }
  }

  // --------------------------------------------------
  // Private: Send bundle to Jito Block Engine
  // --------------------------------------------------
  private async sendBundle(bundle: JitoBundlePayload): Promise<BundleResult> {
    const startTime = Date.now();

    if (USE_MOCK) {
      log.info('Mock send – pretending bundle was accepted');
      await this.delay(50);
      return {
        bundleId: bundle.bundleId,
        accepted: true,
        txSignatures: [`mock_tx_${Date.now()}`],
        slot: Math.floor(Math.random() * 1000000),
        realizedProfitUSD: bundle.expectedProfitUSD || 0.05,
        totalLatencyMs: Date.now() - startTime,
      };
    }

    try {
      const jito = ConnectionManager.getInstance().getJitoClient();
      const txBuffers = bundle.transactions.map((tx) => bs58.decode(tx));
      
      const bundleId = await jito.sendBundle(txBuffers);
      log.info(`Bundle sent: ${bundleId}`);

      return {
        bundleId: bundle.bundleId,
        accepted: true,
        txSignatures: [], // Will be filled after confirmation
        totalLatencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        bundleId: bundle.bundleId,
        accepted: false,
        txSignatures: [],
        error: err.message,
        totalLatencyMs: Date.now() - startTime,
      };
    }
  }

  // --------------------------------------------------
  // Utility
  // --------------------------------------------------
  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ----------------------------------------------------
// 4. Pre-configured instance
// ----------------------------------------------------
export const executor = new ExecutorAgent();

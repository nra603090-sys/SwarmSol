// ============================================
// SwarmSol - File 4: Connection Manager
// Solana RPC Pool & Jito Block Engine Client
// ============================================

import {
  Connection,
  Commitment,
  PublicKey,
  SendOptions,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  SearcherClient,
  searcherClient as createSearcherClient,
} from 'jito-ts';
 {import connectionLogger as log } from './logger';
import { SwarmError, SwarmErrorCode } from './types';
import {
  SOLANA_CONFIG,
  JITO_CONFIG,
  USE_MOCK,
} from './config';

// ----------------------------------------------------
// 1. Types
// ----------------------------------------------------
export interface ConnectionHealth {
  rpcUrl: string;
  healthy: boolean;
  latencyMs: number | null;
  lastChecked: number;
}

// ----------------------------------------------------
// 2. RPC Failover Pool
// ----------------------------------------------------
export class RpcConnectionPool {
  private connections: Connection[];
  private currentIndex: number = 0;
  private healthStatuses: Map<string, ConnectionHealth> = new Map();

  constructor(
    private primaryUrl: string,
    private backupUrls: string[],
    private commitment: Commitment = 'confirmed'
  ) {
    // Build connections list (primary first)
    const allUrls = [primaryUrl, ...backupUrls];
    this.connections = allUrls.map((url) => new Connection(url, commitment));
    // Initialize health statuses
    allUrls.forEach((url) => {
      this.healthStatuses.set(url, {
        rpcUrl: url,
        healthy: true,
        latencyMs: null,
        lastChecked: 0,
      });
    });
  }

  /**
   * Get the current active (healthy) connection
   * Rotates on failure automatically
   */
  getConnection(): Connection {
    // Find first healthy connection starting from currentIndex
    for (let i = 0; i < this.connections.length; i++) {
      const idx = (this.currentIndex + i) % this.connections.length;
      const url = this.getUrlByIndex(idx);
      const health = this.healthStatuses.get(url);
      if (health && health.healthy) {
        this.currentIndex = idx;
        return this.connections[idx];
      }
    }
    // If none healthy, throw error
    throw new SwarmError(
      'All RPC endpoints are unhealthy',
      SwarmErrorCode.RPC_CONNECTION_FAILED
    );
  }

  /**
   * Mark an endpoint as unhealthy after failure
   */
  markUnhealthy(url: string): void {
    const health = this.healthStatuses.get(url);
    if (health) {
      health.healthy = false;
      health.lastChecked = Date.now();
      log.warn(`Marked RPC as unhealthy: ${url}`);
    }
  }

  /**
   * Restore an endpoint to healthy (e.g., after successful retry)
   */
  markHealthy(url: string, latencyMs: number): void {
    const health = this.healthStatuses.get(url);
    if (health) {
      health.healthy = true;
      health.latencyMs = latencyMs;
      health.lastChecked = Date.now();
    }
  }

  /**
   * Perform a health check on all endpoints in the background
   */
  async healthCheck(): Promise<ConnectionHealth[]> {
    const results: ConnectionHealth[] = [];
    for (const conn of this.connections) {
      const url = conn.rpcEndpoint;
      try {
        const start = Date.now();
        await conn.getSlot();
        const latency = Date.now() - start;
        this.markHealthy(url, latency);
        log.debug(`RPC ${url} healthy (${latency}ms)`);
        results.push(this.healthStatuses.get(url)!);
      } catch {
        this.markUnhealthy(url);
        log.warn(`RPC ${url} failed health check`);
        results.push(this.healthStatuses.get(url)!);
      }
    }
    return results;
  }

  /**
   * Get all connection instances (for raw access)
   */
  getAllConnections(): Connection[] {
    return this.connections;
  }

  private getUrlByIndex(index: number): string {
    const urls = [this.primaryUrl, ...this.backupUrls];
    return urls[index] || urls[0];
  }
}

// ----------------------------------------------------
// 3. Jito Client Manager (with Mock Support)
// ----------------------------------------------------
export interface IJitoClient {
  sendBundle(bundle: Uint8Array[]): Promise<string>;
  simulateBundle(bundle: Uint8Array[]): Promise<boolean>;
  getTipAccounts(): Promise<string[]>;
  // Add other needed methods
}

// Real Jito client
class RealJitoClient implements IJitoClient {
  private client: SearcherClient;

  constructor(blockEngineUrl: string) {
    this.client = createSearcherClient(blockEngineUrl);
    log.info(`Jito client connected to ${blockEngineUrl}`);
  }

  async sendBundle(bundle: Uint8Array[]): Promise<string> {
    // Convert to Transactions? jito-ts accepts Uint8Array[] or Transaction[]
    return this.client.sendBundle(bundle);
  }

  async simulateBundle(bundle: Uint8Array[]): Promise<boolean> {
    try {
      const result = await this.client.simulateBundle({ bundle });
      // result contains simulation results; if any tx fails, we treat as not passed
      return result.summary.succeeded === bundle.length;
    } catch (err) {
      log.error(`Bundle simulation error: ${err}`);
      return false;
    }
  }

  async getTipAccounts(): Promise<string[]> {
    const resp = await this.client.getTipAccounts();
    return resp.accounts.map((a: string) => a);
  }
}

// Mock Jito client for demo/development
class MockJitoClient implements IJitoClient {
  async sendBundle(bundle: Uint8Array[]): Promise<string> {
    log.warn('Mock Jito client: bundle sent (not real)');
    await new Promise((r) => setTimeout(r, 50));
    return `mock_bundle_${Date.now()}`;
  }

  async simulateBundle(bundle: Uint8Array[]): Promise<boolean> {
    log.warn('Mock Jito client: simulation passed');
    await new Promise((r) => setTimeout(r, 10));
    // Random success for realism
    return Math.random() > 0.1;
  }

  async getTipAccounts(): Promise<string[]> {
    return [JITO_CONFIG.TIP_ACCOUNT];
  }
}

// ----------------------------------------------------
// 4. Connection Manager (Singleton)
// ----------------------------------------------------
export class ConnectionManager {
  private static instance: ConnectionManager;
  private rpcPool: RpcConnectionPool;
  private jitoClient: IJitoClient;
  private useMock: boolean;

  private constructor() {
    this.useMock = USE_MOCK;
    this.rpcPool = new RpcConnectionPool(
      SOLANA_CONFIG.RPC_URL,
      SOLANA_CONFIG.BACKUP_RPC_URLS,
      SOLANA_CONFIG.COMMITMENT as Commitment
    );

    if (this.useMock) {
      this.jitoClient = new MockJitoClient();
      log.info('Using Mock Jito client');
    } else {
      this.jitoClient = new RealJitoClient(JITO_CONFIG.BLOCK_ENGINE_URL);
    }
  }

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Get a working Solana RPC connection (with failover)
   */
  getConnection(): Connection {
    return this.rpcPool.getConnection();
  }

  /**
   * Get the Jito client (real or mock)
   */
  getJitoClient(): IJitoClient {
    return this.jitoClient;
  }

  /**
   * Perform RPC health check
   */
  async healthCheck(): Promise<ConnectionHealth[]> {
    return this.rpcPool.healthCheck();
  }

  /**
   * Wrap an RPC call with retry logic
   */
  async withRetry<T>(
    fn: (conn: Connection) => Promise<T>,
    maxRetries: number = SOLANA_CONFIG.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const conn = this.getConnection();
      try {
        return await fn(conn);
      } catch (err: any) {
        lastError = err;
        log.warn(`RPC call failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
        this.rpcPool.markUnhealthy(conn.rpcEndpoint);
        // Will rotate on next getConnection() call
      }
    }
    throw new SwarmError(
      `RPC call failed after ${maxRetries + 1} retries: ${lastError?.message}`,
      SwarmErrorCode.RPC_CONNECTION_FAILED
    );
  }

  /**
   * Static convenience accessor
   */
  static get conn(): Connection {
    return ConnectionManager.getInstance().getConnection();
  }

  static get jito(): IJitoClient {
    return ConnectionManager.getInstance().getJitoClient();
  }
}

// ----------------------------------------------------
// 5. Initialization Check (optional)
// ----------------------------------------------------
export async function initializeConnections(): Promise<void> {
  const manager = ConnectionManager.getInstance();
  log.info('Running initial health check...');
  const results = await manager.healthCheck();
  const healthyCount = results.filter((r) => r.healthy).length;
  log.info(`Health check complete: ${healthyCount}/${results.length} RPCs healthy`);
  if (healthyCount === 0 && !USE_MOCK) {
    throw new SwarmError(
      'No healthy RPC endpoints available',
      SwarmErrorCode.RPC_CONNECTION_FAILED
    );
  }
}

import crypto from 'crypto';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

interface CrossChainTransaction {
  chain: string;
  to: string;
  data: any;
}

interface SignedTransaction {
  tx: CrossChainTransaction;
  signature: string;
  broadcast_id: string;
}

export class ChainSignatures {
  private privateKey: string;
  private broadcastLog: Map<string, SignedTransaction> = new Map();

  constructor(privateKey: string) {
    this.privateKey = privateKey || this.generateMockKey();
  }

  private generateMockKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async signAndBroadcast(tx: CrossChainTransaction): Promise<string> {
    const txHash = this.hashTransaction(tx);
    const signature = this.signTransaction(txHash);
    const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const signedTx: SignedTransaction = {
      tx,
      signature,
      broadcast_id: broadcastId,
    };

    this.broadcastLog.set(broadcastId, signedTx);

    logger.info({
      broadcast_id: broadcastId,
      chain: tx.chain,
      to: tx.to,
      action: tx.data.action,
    }, 'Transaction broadcast (mock)');

    await this.simulateBroadcast();

    return broadcastId;
  }

  private hashTransaction(tx: CrossChainTransaction): string {
    const message = JSON.stringify(tx);
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  private signTransaction(txHash: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(txHash);
    
    try {
      const keyBuffer = Buffer.from(this.privateKey, 'hex');
      const privateKey = crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs8',
      });
      return sign.sign(privateKey, 'hex');
    } catch {
      return crypto.randomBytes(64).toString('hex');
    }
  }

  private async simulateBroadcast(): Promise<void> {
    const delay = Math.floor(Math.random() * 500) + 100;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async getTransactionStatus(broadcastId: string): Promise<string> {
    const tx = this.broadcastLog.get(broadcastId);
    if (!tx) {
      return 'not_found';
    }

    const age = Date.now() - parseInt(broadcastId.split('_')[1]);
    if (age < 1000) return 'pending';
    if (age < 5000) return 'confirming';
    return 'confirmed';
  }

  async waitForConfirmation(broadcastId: string, timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getTransactionStatus(broadcastId);
      if (status === 'confirmed') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }

  getTransactionLog(): SignedTransaction[] {
    return Array.from(this.broadcastLog.values());
  }
}
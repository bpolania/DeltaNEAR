import { ChainSignatures } from './chain-signatures';
import { describe, test, expect, beforeEach, afterEach, jest, it } from '@jest/globals';

describe('ChainSignatures', () => {
  let chainSigner: ChainSignatures;

  beforeEach(() => {
    chainSigner = new ChainSignatures('test_private_key');
  });

  describe('signAndBroadcast', () => {
    it('should sign and broadcast transaction', async () => {
      const tx = {
        chain: 'arbitrum',
        to: 'vault.address',
        data: {
          action: 'deposit',
          token: 'USDC',
          amount: '1000',
        },
      };

      const broadcastId = await chainSigner.signAndBroadcast(tx);

      expect(broadcastId).toMatch(/^bcast_\d+_[a-z0-9]+$/);
    });

    it('should generate unique broadcast IDs', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: {
          action: 'post_settlement',
          intent_hash: 'hash123',
        },
      };

      const id1 = await chainSigner.signAndBroadcast(tx);
      const id2 = await chainSigner.signAndBroadcast(tx);

      expect(id1).not.toBe(id2);
    });

    it('should log transactions', async () => {
      const tx1 = {
        chain: 'base',
        to: 'address1',
        data: { action: 'action1' },
      };

      const tx2 = {
        chain: 'solana',
        to: 'address2',
        data: { action: 'action2' },
      };

      await chainSigner.signAndBroadcast(tx1);
      await chainSigner.signAndBroadcast(tx2);

      const log = chainSigner.getTransactionLog();
      expect(log).toHaveLength(2);
      expect(log[0].tx.chain).toBe('base');
      expect(log[1].tx.chain).toBe('solana');
    });

    it('should simulate broadcast delay', async () => {
      const tx = {
        chain: 'arbitrum',
        to: 'vault.address',
        data: { action: 'deposit' },
      };

      const startTime = Date.now();
      await chainSigner.signAndBroadcast(tx);
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('getTransactionStatus', () => {
    it('should return not_found for invalid broadcast ID', async () => {
      const status = await chainSigner.getTransactionStatus('invalid_id');
      expect(status).toBe('not_found');
    });

    it('should return pending for recent transaction', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: { action: 'test' },
      };

      const broadcastId = await chainSigner.signAndBroadcast(tx);
      const status = await chainSigner.getTransactionStatus(broadcastId);
      
      expect(status).toBe('pending');
    });

    it('should transition through status stages', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: { action: 'test' },
      };

      const broadcastId = await chainSigner.signAndBroadcast(tx);
      
      const status1 = await chainSigner.getTransactionStatus(broadcastId);
      expect(status1).toBe('pending');

      await new Promise(resolve => setTimeout(resolve, 1500));
      const status2 = await chainSigner.getTransactionStatus(broadcastId);
      expect(status2).toBe('confirming');

      await new Promise(resolve => setTimeout(resolve, 4000));
      const status3 = await chainSigner.getTransactionStatus(broadcastId);
      expect(status3).toBe('confirmed');
    }, 10000);
  });

  describe('waitForConfirmation', () => {
    it('should wait for confirmation', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: { action: 'test' },
      };

      const broadcastId = await chainSigner.signAndBroadcast(tx);
      
      const startTime = Date.now();
      const confirmed = await chainSigner.waitForConfirmation(broadcastId, 10000);
      const endTime = Date.now();
      
      expect(confirmed).toBe(true);
      // Should take roughly 5 seconds to confirm (with some tolerance)
      expect(endTime - startTime).toBeGreaterThanOrEqual(4500);
      expect(endTime - startTime).toBeLessThan(7000);
    }, 10000);

    it('should timeout if not confirmed', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: { action: 'test' },
      };

      const broadcastId = await chainSigner.signAndBroadcast(tx);
      
      const confirmed = await chainSigner.waitForConfirmation(broadcastId, 100);
      
      expect(confirmed).toBe(false);
    }, 5000);
  });

  describe('Mock key generation', () => {
    it('should generate mock key when not provided', () => {
      const signer = new ChainSignatures('');
      expect(signer['privateKey']).toHaveLength(64);
    });

    it('should use provided key', () => {
      const key = '0123456789abcdef';
      const signer = new ChainSignatures(key);
      expect(signer['privateKey']).toBe(key);
    });
  });

  describe('Transaction hashing', () => {
    it('should generate consistent hash for same transaction', () => {
      const tx = {
        chain: 'arbitrum',
        to: 'vault.address',
        data: {
          action: 'deposit',
          token: 'USDC',
          amount: '1000',
        },
      };

      const hash1 = chainSigner['hashTransaction'](tx);
      const hash2 = chainSigner['hashTransaction'](tx);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate different hash for different transactions', () => {
      const tx1 = {
        chain: 'arbitrum',
        to: 'vault.address',
        data: { amount: '1000' },
      };

      const tx2 = {
        chain: 'arbitrum',
        to: 'vault.address',
        data: { amount: '2000' },
      };

      const hash1 = chainSigner['hashTransaction'](tx1);
      const hash2 = chainSigner['hashTransaction'](tx2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Transaction signature', () => {
    it('should generate signature for transaction hash', () => {
      const txHash = 'a'.repeat(64);
      const signature = chainSigner['signTransaction'](txHash);

      expect(signature).toHaveLength(128);
    });

    it('should generate different signatures for different hashes', () => {
      const hash1 = 'a'.repeat(64);
      const hash2 = 'b'.repeat(64);

      const sig1 = chainSigner['signTransaction'](hash1);
      const sig2 = chainSigner['signTransaction'](hash2);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('Transaction log', () => {
    it('should maintain transaction history', async () => {
      const transactions = [
        { chain: 'near', to: 'addr1', data: { action: 'action1' } },
        { chain: 'arbitrum', to: 'addr2', data: { action: 'action2' } },
        { chain: 'base', to: 'addr3', data: { action: 'action3' } },
      ];

      const broadcastIds = [];
      for (const tx of transactions) {
        const id = await chainSigner.signAndBroadcast(tx);
        broadcastIds.push(id);
      }

      const log = chainSigner.getTransactionLog();
      
      expect(log).toHaveLength(3);
      expect(log.map(entry => entry.broadcast_id)).toEqual(broadcastIds);
      expect(log.map(entry => entry.tx.chain)).toEqual(['near', 'arbitrum', 'base']);
    });

    it('should include signatures in log', async () => {
      const tx = {
        chain: 'near',
        to: 'intents.near',
        data: { action: 'test' },
      };

      await chainSigner.signAndBroadcast(tx);
      
      const log = chainSigner.getTransactionLog();
      expect(log[0].signature).toBeDefined();
      expect(log[0].signature).toHaveLength(128);
    });
  });

  describe('Cross-chain support', () => {
    it('should handle different chains', async () => {
      const chains = ['near', 'arbitrum', 'base', 'solana', 'ethereum', 'polygon'];
      
      for (const chain of chains) {
        const tx = {
          chain,
          to: `${chain}.address`,
          data: { action: 'test' },
        };

        const broadcastId = await chainSigner.signAndBroadcast(tx);
        expect(broadcastId).toBeDefined();
      }

      const log = chainSigner.getTransactionLog();
      expect(log).toHaveLength(chains.length);
      expect(log.map(entry => entry.tx.chain)).toEqual(chains);
    });
  });
});
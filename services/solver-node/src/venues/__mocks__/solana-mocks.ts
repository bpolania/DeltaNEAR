/**
 * Mock Solana Web3.js types for testing
 */

export class Connection {
  constructor(public endpoint: string, public commitment: string) {}
  
  async getSlot(): Promise<number> {
    return 123456789;
  }
  
  async getLatestBlockhash(): Promise<{ blockhash: string }> {
    return { blockhash: 'mock_blockhash_' + Date.now() };
  }
  
  async sendRawTransaction(serialized: Buffer): Promise<string> {
    return 'mock_tx_hash_' + Date.now();
  }
  
  async confirmTransaction(txHash: string, commitment: string): Promise<any> {
    return { value: { err: null } };
  }
}

export class PublicKey {
  constructor(public value: string | Buffer) {}
  
  toString(): string {
    return typeof this.value === 'string' ? this.value : this.value.toString('hex');
  }
}

export class Transaction {
  recentBlockhash?: string;
  signature?: Buffer;
  
  add(instruction: any): void {}
  
  serializeMessage(): Buffer {
    return Buffer.from('mock_serialized_message');
  }
  
  addSignature(pubkey: PublicKey, signature: Buffer): void {
    this.signature = signature;
  }
  
  serialize(): Buffer {
    return Buffer.from('mock_serialized_transaction');
  }
}

export const SystemProgram = {
  transfer: (params: any) => ({
    programId: new PublicKey('11111111111111111111111111111111'),
    keys: [],
    data: Buffer.from('mock_transfer_data')
  })
};

export class BN {
  constructor(public value: string | number) {}
  
  toString(): string {
    return this.value.toString();
  }
  
  toNumber(): number {
    return typeof this.value === 'number' ? this.value : parseInt(this.value);
  }
  
  mul(other: BN): BN {
    const result = this.toNumber() * other.toNumber();
    return new BN(result);
  }
  
  div(other: BN): BN {
    const result = Math.floor(this.toNumber() / other.toNumber());
    return new BN(result);
  }
  
  add(other: BN): BN {
    const result = this.toNumber() + other.toNumber();
    return new BN(result);
  }
  
  sub(other: BN): BN {
    const result = this.toNumber() - other.toNumber();
    return new BN(result);
  }
}
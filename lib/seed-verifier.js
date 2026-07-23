const crypto = require('crypto');

class SeedVerifier {
  static verify(serverSeed, clientSeed, nonce = 0) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHmac('sha256', serverSeed).update(combined).digest('hex');
    const hashInt = parseInt(hash.substring(0, 13), 16);
    const maxHash = Math.pow(16, 13);
    const randomValue = hashInt / maxHash;
    const HOUSE_EDGE = 0.99;
    const crashPoint = Math.max(1.00, Math.floor((HOUSE_EDGE / (1 - randomValue)) * 100) / 100);
    return { serverSeed, clientSeed, nonce, combined, hash, hashInt, randomValue, crashPoint };
  }

  static verifyHistory(seeds) {
    return seeds.map(({ serverSeed, clientSeed, nonce }) => this.verify(serverSeed, clientSeed, nonce));
  }
}

module.exports = SeedVerifier;

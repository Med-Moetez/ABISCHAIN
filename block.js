exports.BlockHeader = class BlockHeader {
  constructor(
    version,
    previousBlockHeader,
    hash,
    rootHash,
    createdAt,
    miner,
    dataValue
  ) {
    // Version of blockchain.
    this.version = version;

    // Previous block header hash - A SHA256(SHA256()) hash of previous block’s header. Ensures that previous block cannot be changed as this block needs to be changed as well.
    this.previousBlockHeader = previousBlockHeader;

    // Current block hash.
    this.hash = hash;

    // Txns hash
    this.rootHash = rootHash;

    // Time the agent created the block.
    this.createdAt = createdAt;

    // Agent id and type
    this.miner = miner;

    // Block value according to its data
    //dataValue={healthValue:1,financeValue:1,itValue:1}
    this.dataValue = dataValue;
  }
};

exports.Block = class Block {
  constructor(blockHeader, index, txns, pruned) {
    this.blockHeader = blockHeader;

    // GenesisBlock is the first block - block 0
    this.index = index;

    // Pruned or not
    this.pruned = pruned;

    // Txns is the raw transaction in the block.
    this.txns = txns;
  }
};

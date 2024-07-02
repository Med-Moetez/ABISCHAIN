const Block = require("./block.js").Block;
const BlockHeader = require("./block.js").BlockHeader;
const { MerkleTree } = require("merkletreejs");
const moment = require("moment");
const SHA256 = require("./constants");
// add level database
const { Level } = require("level");
const fs = require("fs");
let db;
// for checking if level db is empty
// const isEmpty = require("level-is-empty");
//the blockchain
const blockchain = [];

// data base creation method
const createDb = (peerId, Blockchain) => {
  let dir = __dirname + "/db/" + peerId;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    db = new Level(dir);
  }
};
// const checkEmptyDb = () => {
//   isEmpty(db, function(err, empty) {
//     return empty;
//   });
// };

const getGenesisBlock = (miner) => {
  const tree = new MerkleTree([], SHA256);
  const rootHash = tree.getRoot().toString("hex");
  const dataValue = {
    healthValue: 0,
    financeValue: 0,
    itValue: 0,
  };
  let blockHeader = new BlockHeader(
    1,
    null,
    "0x1bc1100000000000000000000000000000000000000000000",
    rootHash,
    moment().unix(),
    miner,
    dataValue
  );
  return new Block(blockHeader, 0, null, false);
};

const getLatestBlock = () => blockchain[blockchain.length - 1];

const addBlock = (newBlock) => {
  if (newBlock.index === 0) {
    blockchain.push(newBlock);
  } else {
    let prevBlock = getLatestBlock();
    if (
      prevBlock?.index < newBlock?.index &&
      newBlock?.blockHeader.previousBlockHeader === prevBlock?.blockHeader.hash
    ) {
      blockchain.push(newBlock);
      storeBlock(newBlock); // When you generate a new block using the generateNextBlock method, you can now store the block in the LevelDB database
    }
  }
};

const addChainBlocks = (chain) => {
  chain.map((newBlock) => {
    if (newBlock.index === 0) {
      blockchain.push(newBlock);
    } else {
      let prevBlock = getLatestBlock();
      if (
        prevBlock.index < newBlock.index &&
        newBlock.blockHeader.previousBlockHeader === prevBlock.blockHeader.hash
      ) {
        blockchain.push(newBlock);
        storeBlock(newBlock); // When you generate a new block using the generateNextBlock method, you can now store the block in the LevelDB database
      }
    }
  });
};
//  method to store blockchain new block
const storeBlock = (newBlock) => {
  db.put(newBlock.index, JSON.stringify(newBlock), function(err) {
    if (err) return console.log("Ooops!", err); // some kind of I/O error
    console.log("--- Inserting block index: " + newBlock.index);
  });
};

//  method to get block from blockchain by index
const getDbBlock = (index) => {
  return new Promise((resolve, reject) => {
    db.get(index, function(err, value) {
      if (err) {
        reject(err);
        return console.log(JSON.stringify(err));
      }

      resolve(value);
    });
  });
};

let getBlock = (index) => {
  if (blockchain.length - 1 >= index) return blockchain[index];
  else return null;
};

const generateNextBlock = async (miner, dataValue, txns) => {
  const prevBlock = getLatestBlock();
  const prevHash = prevBlock.blockHeader.hash;
  const nextIndex = prevBlock.index + 1;
  const nextTime = moment().unix();
  const dataToArray = Object.entries(txns);
  const leaves = dataToArray.map((x) => SHA256(x));
  const tree = new MerkleTree(leaves, SHA256);
  const rootHash = tree.getRoot().toString("hex");
  const nextHash = SHA256(prevHash + nextTime + rootHash).toString();

  const blockHeader = new BlockHeader(
    1,
    prevHash,
    nextHash,
    rootHash,
    nextTime,
    miner,
    dataValue
  );
  const newBlock = new Block(blockHeader, nextIndex, txns, false);
  blockchain.push(newBlock);
  storeBlock(newBlock);
  return newBlock;
};

// Calculate Hash function
const calculateHash = (block) => {
  const { previousBlockHeader, time } = block.blockHeader;
  return SHA256(previousBlockHeader + time).toString();
};

// check blockchain validity
const simpleCheckValid = (blockchain) => {
  for (let i = 1; i < blockchain.length; i++) {
    const currentBlock = blockchain[i];
    const previousBlock = blockchain[i - 1];
    // check current block hash validity
    if (currentBlock.blockHeader.hash !== calculateHash(currentBlock)) {
      return false;
    }

    // check previous block hash validity
    if (
      currentBlock.blockHeader.previousBlockHeader !==
      previousBlock.blockHeader.hash
    ) {
      return false;
    }
  }

  return true;
};
// check blockchain all data validity
const deepCheckValid = (blockchain) => {
  for (let i = 1; i < blockchain.length; i++) {
    const currentBlock = blockchain[i];
    const dataToArray = Object.entries(currentBlock.txns);
    const leaves = dataToArray.map((x) => SHA256(x));
    const tree = new MerkleTree(leaves, SHA256);
    const root = tree.getRoot().toString("hex");

    for (let j = 0; j < dataToArray.length; j++) {
      const leaf = SHA256(dataToArray[i]);
      const proof = tree.getProof(leaf);
      if (tree.verify(proof, leaf, root)) {
        return false;
      }
    }
  }

  return true;
};
// check a specific part of pruned block
const checkDataOfPrunedBlock = (data, block) => {
  const dataToArray = Object.entries(block.txns);
  const leaves = dataToArray.map((x) => SHA256(x));
  const tree = new MerkleTree(leaves, SHA256);
  const root = tree.getRoot().toString("hex");

  const leaf = SHA256(data);
  const proof = tree.getProof(leaf);
  if (tree.verify(proof, leaf, root)) {
    return false;
  }
  return true;
};

//check pruned block validity
const checkPrunedBlock = (block) => {
  if (block.blockHeader.hash !== blockchain[block.index].blockHeader.hash) {
    return false;
  }
  //real block data
  const dataToArray = Object.entries(blockchain[block.index].txns);
  const leaves = dataToArray.map((x) => SHA256(x));
  const tree = new MerkleTree(leaves, SHA256);
  const root = tree.getRoot().toString("hex");

  //  verify pruned blockdata
  const prunedDataToArray = Object.entries(block.txns);
  for (let i = 0; i < prunedDataToArray; i++) {
    const leaf = SHA256(prunedDataToArray[i]);
    const proof = tree.getProof(leaf);
    if (tree.verify(proof, leaf, root)) {
      return false;
    }
  }
  return true;
};

//check the pruned blockchain
const checkPrunedBlockchain = (prunedBlockchain) => {
  for (let i = 1; i < prunedBlockchain.length; i++) {
    return checkPrunedBlock(prunedBlockchain[i]);
  }
  return true;
};
if (typeof exports != "undefined") {
  exports.addBlock = addBlock;
  exports.getBlock = getBlock;
  exports.blockchain = blockchain;
  exports.getLatestBlock = getLatestBlock;
  exports.generateNextBlock = generateNextBlock;
  exports.getGenesisBlock = getGenesisBlock;
  exports.createDb = createDb;
  exports.getDbBlock = getDbBlock;
  exports.storeBlock = storeBlock;
  exports.addChainBlocks = addChainBlocks;
  // exports.checkEmptyDb = checkEmptyDb;
  exports.simpleCheckValid = simpleCheckValid;
  exports.deepCheckValid = deepCheckValid;
  exports.checkDataOfPrunedBlock = checkDataOfPrunedBlock;
  exports.checkPrunedBlock = checkPrunedBlock;
  exports.checkPrunedBlockchain = checkPrunedBlockchain;
}

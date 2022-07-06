const Block = require("./block.js").Block;
const BlockHeader = require("./block.js").BlockHeader;
const moment = require("moment");
const SHA256 = require("./constants");
// add level database
const { Level } = require("level");
const fs = require("fs");
let db;
// for checking if level db is empty
const isEmpty = require("level-is-empty");

// data base creation method
const createDb = (peerId, Blockchain) => {
  let dir = __dirname + "/db/" + peerId;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    db = new Level(dir);
  }
};
const checkEmptyDb = () => {
  isEmpty(myDB, function (err, empty) {
    return empty;
  });
};

const getGenesisBlock = () => {
  let blockHeader = new BlockHeader(
    1,
    null,
    "0x1bc1100000000000000000000000000000000000000000000",
    moment().unix(),
    "0x171b7320",
    "1CAD2B8C"
  );
  return new Block(blockHeader, 0, null);
};

const getLatestBlock = () => blockchain[blockchain.length - 1];

const addBlock = (newBlock) => {
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
  db.put(newBlock.index, JSON.stringify(newBlock), function (err) {
    if (err) return console.log("Ooops!", err); // some kind of I/O error
    console.log("--- Inserting block index: " + newBlock.index);
  });
};

//  method to get block from blockchain by index
const getDbBlock = (index, res) => {
  db.get(index, function (err, value) {
    if (err) return res.send(JSON.stringify(err));
    return res.send(value);
  });
};

let getBlock = (index) => {
  if (blockchain.length - 1 >= index) return blockchain[index];
  else return null;
};

const blockchain = [];

const generateNextBlock = (txns) => {
  const prevBlock = getLatestBlock(),
    prevHash = prevBlock.blockHeader.hash;
  (nextIndex = prevBlock.index + 1),
    (nextTime = moment().unix()),
    (nextHash = SHA256(prevHash + nextTime).toString());

  const blockHeader = new BlockHeader(1, prevHash, nextHash, nextTime);
  const newBlock = new Block(blockHeader, nextIndex, txns);
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
const checkValid = (blockchain) => {
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
  exports.checkEmptyDb = checkEmptyDb;
  exports.checkValid = checkValid;
}

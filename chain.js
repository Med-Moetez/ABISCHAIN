const Block = require("./block.js").Block;
const BlockHeader = require("./block.js").BlockHeader;
const moment = require("moment");
const SHA256 = require("./constants");

let getGenesisBlock = () => {
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

let getLatestBlock = () => blockchain[blockchain.length - 1];

let addBlock = (newBlock) => {
  if (newBlock.index === 0) {
    blockchain.push(newBlock);
  } else {
    let prevBlock = getLatestBlock();
    if (
      prevBlock.index < newBlock.index &&
      newBlock.blockHeader.previousBlockHeader === prevBlock.blockHeader.hash
    ) {
      blockchain.push(newBlock);
    }
  }
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
  // storeBlock(newBlock);
  return newBlock;
};

if (typeof exports != "undefined") {
  exports.addBlock = addBlock;
  exports.getBlock = getBlock;
  exports.blockchain = blockchain;
  exports.getLatestBlock = getLatestBlock;
  exports.generateNextBlock = generateNextBlock;
  exports.getGenesisBlock = getGenesisBlock;
}

// env variables
require("dotenv").config();
//hdd space
const hddSpace = require("hdd-space");

const process = require("node:process");
const crypto = require("crypto");

//A network swarm that uses discovery-channel to find and connect to peers.
//This module implements peer connection state and builds on discovery-channel which implements peer discovery.
//This uses TCP (establishing connection) sockets by default and has experimental support for UTP (without establishing connection).
const Swarm = require("discovery-swarm");
//to simulate bots we will create a network swarm that uses discovery-channel to find and connect peers ("peers represent our bots")
const defaults = require("dat-swarm-defaults");
//Deploys servers that are used to discover other peers
const getPort = require("get-port");
//Gets available TCP ports
const chain = require("./chain");
const CronJob = require("cron").CronJob;

//Express.js is a back end web application framework for Node.js
const express = require("express");
const bodyParser = require("body-parser");

//peer caching system
const Redis = require("redis");
const utils = require("./utlis");

//blockchainDb size
var folderSize = require("folder-size");
const dbPath = "./db";
//selection method based on particle swarm optimization
const pso = require("./pso");

// data classifier
const { dataTypePredict } = require("./dataClassifier");

// import sizeof to get object size
const sizeof = require("object-sizeof");

// our variables of network peers and connection sequence
const peers = {};
let connSeq = 0;
let channel = "myBlockchain";
let blockchainNetworkState = [];
let votingList = [];
let initiatorMiner = null;
let lastBlockMinedBy = null;
let mempool = {};
let pruningListsMempool = [];
let agentPruningList = {};

// list item that will be added to the pruningListsMempool
//sharedAgentPruningList = {
//  agentId,
//  alpha ,
//  y ,
//  prunedBlockchainSize,
//  pruningData ,
//}

// variable for lightnode
let pendingRequestedBlock = null;

const redisClient = Redis.createClient({
  host: "localhost",
  port: 6379,
});

let blockChainSize = 0;
// define a message type to request and receive the latest block
let MessageType = {
  REQUEST_BLOCK: "requestBlock",
  RECEIVE_NEXT_BLOCK: "receiveNextBlock",
  RECEIVE_NEW_BLOCK: "receiveNewBlock",
  REQUEST_ALL_REGISTER_MINERS: "requestAllRegisterMiners",
  REGISTER_MINER: "registerMiner",
  ADD_DATA_TO_MEMPOOL: "addDataToMempool",
  RECEIVE_PRUNED_BLOCKCHAIN: "ReceivePrunedBlockchain",
  SEND_PRUNING_LIST: "SendPruningList",
  RECEIVE_PRUNING_LIST: "ReceivePruningList",
  REQUEST_SPECIFIC_BLOCK: "requestSpecificBlock",
  SEND_SPECIFIC_BLOCK: "sendSpecificBlock",
};
// information about purned blockchain, lasttime that the blockchain was pruned ...
let prunedBlockchainInfo = {
  prunerId: null,
  choosedList: null,
  prunedBlockchainSize: null,
  lastTimePruned: null,
  data: null,
};

const myPeerId = crypto.randomBytes(32).toString("hex");
let peerConnections = 0;
let nodeType = null;
chain.createDb(myPeerId);
console.log("myPeerId: " + myPeerId);

//  initHttpServer  will initiate the server and publish apis
let initHttpServer = (port) => {
  let http_port = "80" + port.toString().slice(-2);
  let app = express();
  app.use(bodyParser.json());

  //  api to retrieve our blockchain
  app.get("/blocks", (req, res) => res.send(JSON.stringify(chain.blockchain)));

  // api to retrieve one block by index
  app.get("/getBlock/:index", async (req, res) => {
    let blockIndex = req.params.index;
    let resultBlock;
    try {
      await utils.getOrSetCache(
        redisClient,
        `blockdataIndex=${blockIndex}`,
        async () => {
          resultBlock = await chain.getDbBlock(blockIndex);
          return resultBlock;
        }
      );

      const redisKeys = await utils.getRedisKeys(redisClient);
      // check if block is already in the agent cache
      if (!redisKeys.includes(`blockdataIndex=${blockIndex}`)) {
        Promise.all(
          redisKeys.map((key) => {
            return new Promise((resolve, reject) => {
              redisClient.get(key, async (error, data) => {
                if (data != null) {
                  return resolve(JSON.parse(data));
                }
                if (error) return reject(error);
              });
            });
          })
        ).then((values) => {
          // cachedData
          const cachedData = values.map((el) => JSON.parse(el));

          // relatedData to cached data
          const DataRelatedToBlockchain = cachedData.map((el) => {
            generateActiveData(el, chain.blockchain);
          });
          // add condition to not prune newly created blocks not pruned
          const dataToPrune = chain.blockchain.filter((blockchainEL) =>
            DataRelatedToBlockchain.every(
              (cachedEl) =>
                cachedEl?.blockHeader?.hash !== blockchainEL?.blockHeader?.hash
            )
          );
          /// data to prune
          console.log("dataToPrune", dataToPrune);
          agentPruningList = { ...agentPruningList, ...dataToPrune };
        });
      }

      return res.send(resultBlock);
    } catch (err) {
      if (nodeType === "lightNode") {
        writeMessageToPeers(MessageType.REQUEST_SPECIFIC_BLOCK, blockIndex);
        setTimeout(function() {
          if (pendingRequestedBlock) {
            res.send(resultBlock);
            pendingRequestedBlock = null;
          } else {
            res.send("error", err);
          }
        }, 5000);
      } else {
        res.send("error", err);
      }
    }
  });

  //  api to retrieve block form database by index
  app.get("/getDBBlock/:index", async (req, res) => {
    let blockIndex = req.params.index;
    try {
      const block = await utils.getOrSetCache(
        redisClient,
        `blockdataIndex=${blockIndex}`,
        async () => {
          const data = await chain.getDbBlock(blockIndex);
          return data;
        }
      );
      return res.send(block);
    } catch (err) {
      res.send("error", err);
    }
  });
  //  api to simple check blockchain validity
  app.get("/checkBlockchain", (req, res) => {
    res.send(chain.simpleCheckValid(chain.blockchain));
  });

  //  api to deep check blockchain validity
  app.get("/deepcheckBlockchain", (req, res) => {
    res.send(
      nodeType === "fullNode"
        ? chain.deepCheckValid(chain.blockchain)
        : chain.checkPrunedBlockchain(chain.blockchain)
    );
  });

  app.listen(http_port, () =>
    console.log("Listening http on port: " + http_port)
  );
};

//  config object that holds peer ID
const config = defaults({
  id: myPeerId,
});

// initialize swarm library using our config
const swarm = Swarm(config);

(async () => {
  // listen on the random port selected
  const port = await getPort();

  initHttpServer(port); // call the initHttpServer

  swarm.listen(port);
  console.log("Listening port: " + port);

  swarm.join(channel);
  swarm.on("connection", (conn, info) => {
    const seq = connSeq;
    const peerId = info.id;
    peerConnections = swarm.connected;

    console.log(`Connected #${seq} to peer: ${peerId}`);

    if (info.initiator) {
      try {
        initiatorMiner = myPeerId;
        // setKeepAlive to ensure that the network connection stays with other peers
        conn.setKeepAlive(true, 600);
      } catch (exception) {
        console.log("exception", exception);
      }
    }

    // Once receiving a data message on the P2P network, parsing data using JSON.parse
    conn.on("data", (data) => {
      let message = JSON.parse(data);
      console.log("----------- Received Message start -------------");
      console.log(
        "from: " + peerId,
        "to: " + peerId.toString(message.to),
        "my: " + myPeerId,
        "type: " + JSON.stringify(message.type)
      );
      console.log("----------- Received Message end -------------");

      // once data event message is received, handling our different types of requests
      switch (message.type) {
        case MessageType.REQUEST_BLOCK:
          console.log("-----------REQUEST_BLOCK-------------");
          let requestedIndex = JSON.parse(JSON.stringify(message.data)).index;
          let requestedBlock = chain.getBlock(requestedIndex);
          if (requestedBlock)
            writeMessageToPeerToId(
              peerId,
              MessageType.RECEIVE_NEXT_BLOCK,
              requestedBlock
            );
          else console.log("No block found @ index: " + requestedIndex);
          console.log("-----------REQUEST_BLOCK-------------");
          break;

        case MessageType.RECEIVE_NEXT_BLOCK:
          console.log("-----------RECEIVE_NEXT_BLOCK-------------");
          chain.addBlock(JSON.parse(JSON.stringify(message.data)));
          console.log(JSON.stringify(chain.blockchain));
          let nextBlockIndex =
            chain.blockchain.length === 0
              ? 0
              : chain.getLatestBlock().index + 1;
          console.log("-- request next block @ index: " + nextBlockIndex);
          writeMessageToPeers(MessageType.REQUEST_BLOCK, {
            index: nextBlockIndex,
          });
          console.log("-----------RECEIVE_NEXT_BLOCK-------------");
          break;

        case MessageType.RECEIVE_NEW_BLOCK:
          if (message.to === myPeerId && message.from !== myPeerId) {
            console.log(
              "-----------RECEIVE_NEW_BLOCK------------- " + message.to
            );

            if (chain.checkEmptyDb && chain.blockchain.length > 0) {
              chain.addChainBlocks(chain.blockchain);
              chain.addBlock(JSON.parse(JSON.stringify(message.data)));
            } else {
              chain.addBlock(JSON.parse(JSON.stringify(message.data)));
              votingList = [];
              pruningListsMempool = [];
              //∑_(𝒊=𝟏)^𝒏▒〖𝒙_𝒊∗𝒗_(𝒊 ) 〗
              const blockchainAgentAddedValue = chain.blockchain.filter(
                (block, index) => {
                  if (block.blockHeader.miner === myPeerId) {
                    const {
                      healthValue,
                      financeValue,
                      itValue,
                    } = block.blockHeader.dataValue;
                    // data weight eg. weight eqaul to 3 for health, as we consider health data is more imporatant than finance or it data
                    return (
                      index * (3 * healthValue + 2 * financeValue + itValue)
                    );
                  }
                }
              );

              // delete pruning data from current currentBlockchainToPrune
              const agentPrunedblockchain = currentBlockchainToPrune.map(
                (block) => {
                  return Object.keys(block).forEach(function(key, index) {
                    if (psoList.pruningData.includes(key)) delete block[key];
                  });
                }
              );

              // get agent pruned blockchain size
              const agentPrunedBlockchainSize = sizeof(agentPrunedblockchain);

              const AgentAlphaValue = blockchainAgentAddedValue?.reduce(
                (a, b) => a + b
              );
              // sharedAgentPruningList list that will be sent to other agents
              let sharedAgentPruningList = {
                agentId: myPeerId,
                alpha: AgentAlphaValue,
                y: peerConnections,
                prunedBlockchainSize: agentPrunedBlockchainSize,
                pruningData: agentPruningList,
              };

              writeMessageToPeers(
                MessageType.RECEIVE_PRUNING_LIST,
                sharedAgentPruningList
              );
              agentPruningList = {};
            }
            console.log(JSON.stringify(chain.blockchain));
            console.log(
              "-----------RECEIVE_NEW_BLOCK------------- " + message.to
            );
          }
          break;

        case MessageType.RECEIVE_PRUNED_BLOCKCHAIN:
          if (message.to === myPeerId && message.from !== myPeerId) {
            console.log(
              "-----------RECEIVE_PRUNED_BLOCKCHAIN------------- " + message.to
            );

            votingList = [];
            pruningListsMempool = [];
            prunedBlockchainInfo = JSON.parse(JSON.stringify(message.data));

            console.log(
              "-----------RECEIVE_PRUNED_BLOCKCHAIN------------- " + message.to
            );
          }
          break;

        case MessageType.RECEIVE_PRUNING_LIST:
          if (message.to === myPeerId && message.from !== myPeerId) {
            console.log(
              "-----------RECEIVE_PRUNING_LIST------------- " + message.to
            );

            const newpruningListsMempool = pruningListsMempool.push(
              JSON.parse(JSON.stringify(message.data))
            );
            pruningListsMempool = newpruningListsMempool;

            console.log(
              "-----------RECEIVE_PRUNING_LIST------------- " + message.to
            );
          }
          break;

        case MessageType.REQUEST_ALL_REGISTER_MINERS:
          console.log(
            "-----------REQUEST_ALL_REGISTER_MINERS------------- " + message.to
          );
          writeMessageToPeers(
            MessageType.REGISTER_MINER,
            blockchainNetworkState
          );
          blockchainNetworkState = JSON.parse(JSON.stringify(message.data));
          console.log(
            "-----------REQUEST_ALL_REGISTER_MINERS------------- " + message.to
          );
          break;

        case MessageType.REGISTER_MINER:
          console.log("-----------REGISTER_MINER------------- " + message.to);
          let miners = JSON.stringify(message.data);
          blockchainNetworkState = JSON.parse(miners);
          console.log(blockchainNetworkState);
          console.log("-----------REGISTER_MINER------------- " + message.to);
          break;

        case MessageType.ADD_DATA_TO_MEMPOOL:
          console.log(
            "-----------ADD_DATA_TO_MEMPOOL------------- " + message.to
          );
          mempool = {
            ...mempool,
            ...JSON.parse(JSON.stringify(message.data)),
          };
          console.log(mempool);
          console.log(
            "-----------ADD_DATA_TO_MEMPOOL------------- " + message.to
          );
          break;

        case MessageType.REQUEST_SPECIFIC_BLOCK:
          if (nodeType === "fullNode") {
            console.log("-----------REQUEST_SPECIFIC_BLOCK-------------");
            let index = JSON.stringify(message.data);
            let requestedSpecifcBlock = chain.getBlock(index);
            writeMessageToPeerToId(
              peerId,
              MessageType.SEND_SPECIFIC_BLOCK,
              requestedSpecifcBlock || null
            );
            console.log("-----------REQUEST_SPECIFIC_BLOCK-------------");
          }
          break;
        case MessageType.SEND_SPECIFIC_BLOCK:
          console.log("-----------SEND_SPECIFIC_BLOCK-------------");
          if (message.data) {
            pendingRequestedBlock = JSON.stringify(message.data);
            return console.log(pendingRequestedBlock);
          }

          console.log("-----------SEND_SPECIFIC_BLOCK-------------");
          break;
      }
    });

    //    Close event, will indicate loosing connection with other peers,
    //   so deleting current peer from our peers object.

    conn.on("close", () => {
      console.log(`Connection ${seq} closed, peerId: ${peerId}`);
      if (peers[peerId].seq === seq) {
        delete peers[peerId];
        console.log(
          "--- blockchainNetworkState before: " +
            JSON.stringify(blockchainNetworkState)
        );
        let index = blockchainNetworkState.findIndex((object) => {
          return object.id === peerId;
        });
        if (index > -1) blockchainNetworkState.splice(index, 1);
        console.log(
          "--- blockchainNetworkState end: " +
            JSON.stringify(blockchainNetworkState)
        );
      }
    });

    if (!peers[peerId]) {
      peers[peerId] = {};
    }
    peers[peerId].conn = conn;
    peers[peerId].seq = seq;
    connSeq++;
  });
})();

// writeMessageToPeers => a method that will send messages to all the connected peers
writeMessageToPeers = (type, data) => {
  for (let id in peers) {
    console.log("-------- writeMessageToPeers start -------- ");
    console.log("type: " + type + ", to: " + id);
    console.log("-------- writeMessageToPeers end ----------- ");
    sendMessage(id, type, data);
  }
};

// writeMessageToPeerToId => a method that will send the message to a specific peer ID
writeMessageToPeerToId = (toId, type, data) => {
  for (let id in peers) {
    if (id === toId) {
      console.log("-------- writeMessageToPeerToId start -------- ");
      console.log("type: " + type + ", to: " + toId);
      console.log("-------- writeMessageToPeerToId end ----------- ");
      sendMessage(id, type, data);
    }
  }
};

//   sendMessage is a generic method that we will be using to send a
//   message formatted with the params that we like to pass , it includes:
// – to/from: The peer ID you are sending the message from and to
// – type: The message type
// – data: Any data you would like to share on the P2P network

sendMessage = (id, type, data) => {
  peers[id].conn.write(
    JSON.stringify({
      to: id,
      from: myPeerId,
      type: type,
      data: data,
    })
  );
};

setTimeout(function() {
  writeMessageToPeers(MessageType.REQUEST_ALL_REGISTER_MINERS, null);
}, 5000);

// using a setTimeout function to send a message send a request to retrieve the latest block every 5 seconds
setTimeout(function() {
  writeMessageToPeers(MessageType.REQUEST_BLOCK, {
    index: chain.blockchain.length === 0 ? 0 : chain.getLatestBlock().index + 1,
  });
}, 5000);

setTimeout(async () => {
  /// get node free disk space
  const freeSpace = await hddSpace.fetchHddInfo({ format: "gb" });

  nodeType = parseInt(freeSpace?.total?.free) > 100 ? "fullNode" : "lightNode";
  const agent = { id: myPeerId, nodeType, connections: peerConnections };

  blockchainNetworkState.push(agent);
  console.log("----------Register my agent --------------");
  console.log(blockchainNetworkState);
  writeMessageToPeers(MessageType.REGISTER_MINER, blockchainNetworkState);
  console.log("---------- Register my agent --------------");
}, 7000);

// add data to mempool  every 5 seconds
setTimeout(async function() {
  const fakeData = await utils.fetchFakeData();
  mempool =
    Object.keys(mempool).length === 0 ? fakeData : { ...mempool, ...fakeData };
  writeMessageToPeers(MessageType.ADD_DATA_TO_MEMPOOL, mempool);
}, 5000);

// \\ main // \\
const job = new CronJob("15 * * * * *", async function() {
  const agent = {
    id: myPeerId,
    type: nodeType,
  };
  let agentToMine = myPeerId;
  // pruned Blockchain Data
  const currentBlockchainToPrune = prunedBlockchainInfo.data
    ? prunedBlockchainInfo.data
    : chain.blockchain;

  const prunedBlockchainSize = await sizeof(currentBlockchainToPrune);

  let index = 0; // first block
  // requesting next block from your next agent
  if (lastBlockMinedBy) {
    let newIndex = blockchainNetworkState.indexOf(lastBlockMinedBy);
    index = newIndex + 1 > blockchainNetworkState.length - 1 ? 0 : newIndex + 1;
  }

  // To generate and add a new block, we will call chain
  // generateNextBlock and addBlock. Lastly, we will broadcast the new
  // block to all the connected peers.

  lastBlockMinedBy = blockchainNetworkState[index];
  console.log(
    "-- REQUESTING NEW BLOCK FROM: " +
      blockchainNetworkState[index].id +
      ", index: " +
      index
  );

  console.log(
    JSON.stringify(
      blockchainNetworkState,
      blockchainNetworkState[index] === myPeerId,
      blockchainNetworkState[index],
      myPeerId
    )
  );

  if (blockchainNetworkState.length > 0 && chain.blockchain.length > 0) {
    // voting data
    const votes = await blockchainNetworkState.reduce(
      (accumulator, currentValue) => {
        //∑_(𝒊=𝟏)^𝒏▒〖𝒙_𝒊∗𝒗_(𝒊 ) 〗
        const blockchainAgentAddedValue = chain.blockchain.filter(
          (block, index) => {
            if (block.blockHeader.miner === currentValue.id) {
              const {
                healthValue,
                financeValue,
                itValue,
              } = block.blockHeader.dataValue;
              return index * (3 * healthValue + 2 * financeValue + itValue);
            }
          }
        );
        // vote according to our formula
        const voteValue =
          blockchainAgentAddedValue?.reduce((a, b) => a + b) +
          currentValue.connections +
          1;
        const agent = {
          id: currentValue.id,
          nodeType: currentValue.nodeType,
          connections: currentValue.connections,
          voteValue: voteValue,
        };
        accumulator.push(agent);
      },
      []
    );

    agentvotes = {
      agentId: myPeerId,
      votes: votes,
    };
    votingList.push(agentvotes);

    // remove agent voting duplications
    const agentIds = votingList.map((o) => o.id);
    const filteredVotingList = votingList.filter(
      ({ agentId }, index) => !agentIds.includes(agentId, index + 1)
    );

    // merge agents voting results into an array
    let mergeAllAgentsVotes = await filteredVotingList?.reduce((acc, item) => {
      return acc.push(...item.votes);
    }, []);

    // get each agent global voting value
    let agentsVotesFinalValues = await mergeAllAgentsVotes.reduce(
      (acc, item) => {
        let existItem = acc.find((currentItem) => item.id === currentItem.id);
        if (existItem) {
          existItem.voteValue += item.voteValue;
        } else {
          acc.push(item);
        }
        return acc;
      },
      []
    );

    //check the last time that a full node mined a block

    const lastBlockMinedByFullnode = chain.blockchain
      .slice(0)
      .reverse()
      .findIndex((item) => item.blockHeader.miner.type === "fullNode");
    // final AgentVotes List
    const finalAgentVotesList =
      lastBlockMinedByFullnode > 10
        ? agentsVotesFinalValues.filter((item) => item.nodeType === "fullNode")
        : lastBlockMinedByFullnode;
    // sort agents by their global voting values
    const descOrderAgents = finalAgentVotesList.sort(
      (a, b) => parseFloat(b.voteValue) - parseFloat(a.voteValue)
    );
    // if the last block is mined by the best agent in the current list, the second agent in the list will do the mining job
    agentToMine =
      descOrderAgents[0] === chain.getLatestBlock().blockHeader.miner &&
      descOrderAgents.length > 1
        ? descOrderAgents[1]
        : descOrderAgents[0];
  }

  if (agentToMine === myPeerId) {
    console.log(
      "-----------creating new block || pruning blockchain -----------------"
    );
    // block creation
    let newBlock = null;

    if (
      chain.blockchain.length === 0 &&
      (initiatorMiner === null || myPeerId === initiatorMiner)
    ) {
      newBlock = chain.getGenesisBlock(agent);
      chain.storeBlock(newBlock);
    } else {
      // check mempoolSiZE en MB
      const currentMempoolDataSize =
        Buffer.byteLength(JSON.stringify(mempool)) / Math.pow(1024, 2);
      // check the time of the last block created per second
      const diffTimeFromLastMinedBlock =
        Math.abs(
          new Date().getTime() - chain.getLatestBlock().blockHeader.createdAt
        ) / 1000;
      // check mempoolDataSize > 1 mb && the elapsed time from last mined block = 60s
      if (currentMempoolDataSize > 1 || diffTimeFromLastMinedBlock > 60) {
        const resultDataValue = dataTypePredict(mempool);
        //Create the new block with mempool data
        newBlock = chain.generateNextBlock(agent, resultDataValue, mempool);

        // clear mempool
        mempool = {};

        chain.addBlock(newBlock);

        console.log(JSON.stringify(newBlock));
        writeMessageToPeers(MessageType.RECEIVE_NEW_BLOCK, newBlock);
        votingList = [];
      }
      const diffTime =
        Date.now().getTime() - prunedBlockchainInfo.lastTimePruned.getTime();
      const diffhoursLastTimePrunnig = Math.floor(diffTime / 1000 / 60);

      // current DB Size
      await folderSize(dbPath, { ignoreHidden: true }, (err, data) => {
        if (err) {
          throw err;
        }
        let dbSize = data?.ldb;
        blockChainSize = (dbSize / Math.pow(1024, 2)).toFixed(2);
      });
      /// if elapsed time from last pruning is over than 10min or blockChainSize over 10MGB
      //  then do pso for selecting pruning list and return pruned blockchain
      const currentPrunningBlockchainSize = (
        prunedBlockchainInfo.prunedBlockchainSize / Math.pow(1024, 2)
      ).toFixed(2);
      if (
        (diffhoursLastTimePrunnig > 10 || currentPrunningBlockchainSize > 10) &&
        pruningListsMempool.length > 0
      ) {
        /// target error default value 1
        const target_error = 1;
        /// lists
        // top lists
        const n_head_lists = 10;
        // ratio eliminator
        const list_eliminator_ratio = 0.9;
        ///current_blockchain_size
        const current_blockchain_size = prunedBlockchainSize;
        let psoList = pso(
          target_error,
          pruningListsMempool,
          list_eliminator_ratio,
          n_head_lists,
          current_blockchain_size
        );
        // returned psoList
        if (psoList) {
          // delete pruning data from current currentBlockchainToPrune
          const newPrunedblockchain = await currentBlockchainToPrune.map(
            (block) => {
              return Object.keys(block).forEach(function(key, index) {
                if (psoList.pruningData.includes(key)) delete block[key];
              });
            }
          );

          // get the pruned blockchain size
          const newPrunedBlockchainSize = await sizeof(newPrunedblockchain);

          /// new pruned Blockchain prunedBlockchainInfo
          prunedBlockchainInfo = {
            prunerId: myPeerId,
            choosedList: psoList,
            prunedBlockchainSize: newPrunedBlockchainSize,
            lastTimePruned: Date.now(),
            data: newPrunedblockchain,
          };
          writeMessageToPeers(
            MessageType.RECEIVE_PRUNED_BLOCKCHAIN,
            prunedBlockchainInfo
          );
        }
      }

      console.log(JSON.stringify(chain.blockchain));
      console.log(
        "-----------creating new block || pruning blockchain -----------------"
      );
    }
    // display current blockchain state
    setTimeout(function() {
      console.log("CURRENT ABISCHAIN BLOCKCHAIN  STATE", chain.blockchain);
    }, 5000);
  }
});
job.start();

process.on("SIGINT", async () => {
  console.log("Leaving the Abischain network.");
  /// clear redis data
  redisClient.flushdb(function(err, succeeded) {
    console.log("redis cache cleaned successfully", succeeded);
    // will be true if successfull
    process.exit();
  });
});

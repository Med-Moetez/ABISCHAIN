// env variables
require("dotenv").config();
//hdd space
const hddSpace = require("hdd-space");

const process = require("node:process");
const crypto = require("crypto");
const si = require("systeminformation");
//A network swarm that uses discovery-channel to find and connect to peers.
//This module implements peer connection state and builds on discovery-channel which implements peer discovery.
//This uses TCP (establishing connection) sockets by default and has experimental support for UTP (without establishing connection).
const Swarm = require("discovery-swarm");
//to simulate agents we will create a network swarm that uses discovery-channel to find and connect peers ("peers represent our agents")
const defaults = require("dat-swarm-defaults");
//Deploys servers that are used to discover other peers
const getPort = require("get-port");
//Gets available TCP ports
const chain = require("./chain");
const CronJob = require("cron").CronJob;

//Express.js is a back end web application framework for Node.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
//peer caching system
const Redis = require("redis");
const utils = require("./utils");

//blockchainDb size
var folderSize = require("folder-size");
const dbPath = "./db";
//selection method based on particle swarm optimization
const pso = require("./pso");

// data classifier
const { dataTypePredict } = require("./dataClassifier");

// import sizeof to get object size
const sizeof = require("object-sizeof");

// performance evaluation
const { performance, PerformanceObserver } = require("perf_hooks");

const iotData = require("./RT-IOT.json");

const perfObserver = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    console.log("performance", entry);
  });
});
perfObserver.observe({ entryTypes: ["function"] });

// our variables of network peers and connection sequence
const peers = {};
let connSeq = 0;
let channel = "myBlockchain";
var blockchainNetworkState = [];
let votingList = [];
let initiatorMiner = null;
let lastBlockMinedBy = null;
// let mempool = [...iotData];
let mempool = [];
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

const PORT = process.env.PORT || 3000;
const TYPE = process.env.TYPE || "fullNode";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const redisClient = Redis.createClient({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

// const redisClient = Redis.createClient({
//   host: "redis",
//   port: 6379,
// });
let blockChainSize = 0;
// define a message type to request and receive the latest block
let MessageType = {
  REQUEST_BLOCK: "requestBlock",
  RECEIVE_NEXT_BLOCK: "receiveNextBlock",
  RECEIVE_NEW_BLOCK: "receiveNewBlock",
  REQUEST_ALL_REGISTER_MINERS: "requestAllRegisterMiners",
  REGISTER_MINER: "registerMiner",
  ADD_DATA_TO_MEMPOOL: "addDataToMempool",
  RESET_MEMPOOL: "resetMempool",
  RECEIVE_PRUNED_BLOCKCHAIN: "ReceivePrunedBlockchain",
  SEND_PRUNING_LIST: "SendPruningList",
  RECEIVE_PRUNING_LIST: "ReceivePruningList",
  REQUEST_SPECIFIC_BLOCK: "requestSpecificBlock",
  SEND_SPECIFIC_BLOCK: "sendSpecificBlock",
};
// information about pruned blockchain, last time that the blockchain was pruned ...
let prunedBlockchainInfo = {
  prunerId: null,
  choosedList: null,
  prunedBlockchainSize: null,
  lastTimePruned: null,
  data: null,
};

// pruned Blockchain Data
const currentBlockchainToPrune = prunedBlockchainInfo.data
  ? prunedBlockchainInfo.data
  : chain.blockchain;

//psolist

let psoList = null;

const myPeerId = crypto.randomBytes(32);
let peerConnections = 0;

let nodeType = TYPE;

chain.createDb(myPeerId.toString("hex"));
console.log("myPeerId: " + myPeerId.toString("hex"));

//  initHttpServer  will initiate the server and publish APIs
let initHttpServer = (port) => {
  let http_port = PORT || "8075";

  let app = express();
  // Increasing the payload limit
  app.use(cors());
  // app.use(bodyParser.json());
  app.use(bodyParser.json({ limit: "50mb" }));

  //  API to retrieve our blockchain
  app.get("/stats", async (req, res) => {
    let fullNodeCount = 0;
    let lightNodeCount = 0;

    blockchainNetworkState?.forEach((node) => {
      if (node.nodeType === "fullNode") {
        fullNodeCount++;
      } else if (node.nodeType === "lightNode") {
        lightNodeCount++;
      }
    });

    const blockchainTransactionsCount = chain.blockchain.reduce(
      (acc, block) => {
        const dataValue = block.txns?.length || 0;
        acc += dataValue || 0;
        return acc;
      },
      0
    );

    const reducedDataValue = chain.blockchain.reduce(
      (acc, block) => {
        const dataValue = block.blockHeader.dataValue;
        acc.healthValue += dataValue.healthValue || 0;
        acc.financeValue += dataValue.financeValue || 0;
        acc.itValue += dataValue.itValue || 0;
        return acc;
      },
      {
        healthValue: 0,
        financeValue: 0,
        itValue: 0,
      }
    );

    const dataType = {
      healthValue: reducedDataValue.healthValue / chain.blockchain.length || 0,
      financeValue:
        reducedDataValue.financeValue / chain.blockchain.length || 0,
      itValue: reducedDataValue.itValue / chain.blockchain.length || 0,
    };
    const typesStats = {
      fullNodeCount,
      lightNodeCount,
    };

    const txnLengths = chain.blockchain?.map((block) =>
      block.txns ? block.txns.length : 0
    );
    const agentsCount = blockchainNetworkState?.length;

    const cpu = await si.cpu();
    const mem = await si.mem();
    const osInfo = await si.osInfo();
    const disk = await si.diskLayout();
    const network = await si.networkInterfaces();

    const data = {
      blocksCount: chain?.blockchain?.length || 0,
      dataType,
      typesStats,
      txnLengths,
      agentsCount,
      prunerId: prunedBlockchainInfo?.prunerId,
      lastTimePruned: prunedBlockchainInfo?.lastTimePruned,
      blockchainTransactionsCount,
      pendingTransactionsCount: mempool?.length,
      cpu,
      mem,
      osInfo,
      disk,
      network,
    };

    res.json(data);
  });

  //  API to add data
  app.post("/addData", async (req, res) => {
    try {
      // Check if req.body is present and is an array
      const jsonData = JSON.parse(req.body?.body);
      if (jsonData) {
        console.log("number of transactions", jsonData?.length);
        writeMessageToPeers(MessageType.ADD_DATA_TO_MEMPOOL, jsonData);
        mempool.push(...jsonData);
        res.send("Product is added to the mempool");
      } else {
        res.status(400).send("Invalid data format: expected an array");
      }
    } catch (err) {
      console.error("Failed to process request:", err);
      res.status(400).send("Failed to process request");
    }
  });

  //API to retrieve mempool
  app.get("/mempool", (req, res) => res.json(mempool));

  //  API to retrieve the last block
  app.get("/lastBlock", (req, res) =>
    res.json(chain.blockchain[chain.blockchain.length - 1])
  );
  //  API to retrieve blocks
  app.get("/blocks", (req, res) => res.json(chain.blockchain));

  //  API to retrieve our pruned blockchain
  app.get("/prunedBlocks", (req, res) => {
    const result = currentBlockchainToPrune;
    res.json(result);
  });

  // API to retrieve one block by index
  app.get("/getBlock/:index", async (req, res) => {
    try {
      let blockIndex = req.params.index;
      let resultBlock;

      if (chain.blockchain.length - 1 < blockIndex) {
        return res.json({
          error: "Block index out of range",
        });
      }

      resultBlock = await utils.getOrSetCache(
        redisClient,
        `blockdataIndex=${blockIndex}`,
        async () => {
          return await chain.getBlock(blockIndex);
        }
      );

      const redisKeys = await utils.getRedisKeys(redisClient);

      // Check if block is already in the agent cache
      if (!redisKeys.includes(`blockdataIndex=${blockIndex}`)) {
        const cachedData = await Promise.all(
          redisKeys.map(async (key) => {
            const data = await utils.getCache(redisClient, key);
            return JSON.parse(data);
          })
        );

        const dataRelatedToBlockchain = cachedData?.map((el) => {
          return utils.generateActiveData(el, chain.blockchain);
        });

        const dataToPrune = chain.blockchain.filter((blockchainEl) => {
          return dataRelatedToBlockchain.every((cachedEl) => {
            return (
              cachedEl?.blockHeader?.hash !== blockchainEl?.blockHeader?.hash
            );
          });
        });

        // dataToPrune should be an array of blocks
        console.log("dataToPrune", dataToPrune);
        // Assuming agentPruningList is a global variable defined elsewhere
        agentPruningList = {
          ...agentPruningList,
          ...dataToPrune,
        };
      }

      return res.json(resultBlock);
    } catch (err) {
      if (nodeType === "lightNode") {
        writeMessageToPeers(MessageType.REQUEST_SPECIFIC_BLOCK, blockIndex);
        setTimeout(function() {
          if (pendingRequestedBlock) {
            res.json(pendingRequestedBlock); // Corrected here
            pendingRequestedBlock = null;
          } else {
            res.json({
              error: "Error occurred while processing the request",
            });
          }
        }, 5000);
      } else {
        res.json({
          error: "Error occurred while processing the request",
        });
      }
    }
  });

  //  API to retrieve block from database by index
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
      res.json(block);
    } catch (err) {
      res.json("error", err);
    }
  });
  //  API to simply check blockchain validity
  app.get("/checkBlockchain", (req, res) => {
    res.json(chain.simpleCheckValid(chain.blockchain));
  });

  //  API to deep check blockchain validity
  app.get("/deepcheckBlockchain", (req, res) => {
    res.json(
      nodeType === "fullNode"
        ? chain.deepCheckValid(chain.blockchain)
        : chain.checkPrunedBlockchain(chain.blockchain)
    );
  });

  // Error handling middleware - must be defined last
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send("Something broke!");
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
    const peerId = info.id.toString("hex");
    peerConnections = swarm.connected;

    console.log(`Connected #${seq} to peer: ${peerId}`);

    if (info.initiator) {
      try {
        initiatorMiner = myPeerId.toString("hex");
        // setKeepAlive to ensure that the network connection stays with other peers
        conn.setKeepAlive(true, 1000);
      } catch (exception) {
        console.log("exception", exception);
      }
    }

    // Accumulate the chunks of data
    let dataBuffer = "";

    // Once receiving a data message on the P2P network, parsing data using JSON.parse
    conn.on("data", (chunk) => {
      dataBuffer += chunk;

      try {
        // Attempt to parse the accumulated data
        const message = JSON.parse(dataBuffer);

        // Clear the buffer after successful parsing
        dataBuffer = "";

        console.log("----------- Received Message start -------------");
        console.log(
          "from: " + peerId.toString("hex"),
          "to: " + peerId.toString(message.to),
          "my: " + myPeerId.toString("hex"),
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
                peerId.toString("hex"),
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
            if (
              message.to === myPeerId.toString("hex") &&
              message.from !== myPeerId.toString("hex")
            ) {
              console.log(
                "-----------RECEIVE_NEW_BLOCK------------- " + message.to
              );

              // if (chain.checkEmptyDb && chain.blockchain.length > 0) {

              if (false) {
                chain.addChainBlocks(chain.blockchain);
                chain.addBlock(JSON.parse(JSON.stringify(message.data)));
              } else {
                chain.addBlock(JSON.parse(JSON.stringify(message.data)));
                votingList = [];
                pruningListsMempool = [];
                const blockchainAgentAddedValue = chain.blockchain.filter(
                  (block, index) => {
                    if (
                      block.blockHeader.miner.id === myPeerId.toString("hex")
                    ) {
                      const {
                        healthValue,
                        financeValue,
                        itValue,
                      } = block.blockHeader.dataValue;
                      return (
                        index * (3 * healthValue + 2 * financeValue + itValue)
                      );
                    }
                  }
                );

                const agentPrunedblockchain = currentBlockchainToPrune?.map(
                  (block) => {
                    return Object.keys(block).forEach(function(key, index) {
                      if (psoList?.pruningData?.includes(key))
                        delete block[key];
                    });
                  }
                );

                const agentPrunedBlockchainSize = sizeof(agentPrunedblockchain);

                const AgentAlphaValue = blockchainAgentAddedValue?.reduce(
                  (a, b) => a + b,
                  []
                );

                let sharedAgentPruningList = {
                  agentId: myPeerId.toString("hex"),
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
            if (
              message.to === myPeerId.toString("hex") &&
              message.from !== myPeerId.toString("hex")
            ) {
              console.log(
                "-----------RECEIVE_PRUNED_BLOCKCHAIN------------- " +
                  message.to
              );

              votingList = [];
              pruningListsMempool = [];
              prunedBlockchainInfo = message.data;

              console.log(
                "-----------RECEIVE_PRUNED_BLOCKCHAIN------------- " +
                  message.to
              );
            }
            break;

          case MessageType.RECEIVE_PRUNING_LIST:
            if (
              message.to === myPeerId.toString("hex") &&
              message.from !== myPeerId.toString("hex")
            ) {
              console.log(
                "-----------RECEIVE_PRUNING_LIST------------- " + message.to
              );

              const newpruningListsMempool = pruningListsMempool.push(
                message.data
              );
              pruningListsMempool = newpruningListsMempool;

              console.log(
                "-----------RECEIVE_PRUNING_LIST------------- " + message.to
              );
            }
            break;

          case MessageType.REQUEST_ALL_REGISTER_MINERS:
            console.log(
              "-----------REQUEST_ALL_REGISTER_MINERS------------- " +
                message.to
            );
            writeMessageToPeers(
              MessageType.REGISTER_MINER,
              blockchainNetworkState
            );
            blockchainNetworkState = JSON.parse(JSON.stringify(message.data));
            console.log(
              "-----------REQUEST_ALL_REGISTER_MINERS------------- " +
                message.to
            );
            break;

          case MessageType.REGISTER_MINER:
            console.log("-----------REGISTER_MINER------------- " + message.to);
            let agents = JSON.stringify(message.data);
            blockchainNetworkState = JSON.parse(agents);
            console.log(blockchainNetworkState);
            console.log("-----------REGISTER_MINER------------- " + message.to);
            break;

          case MessageType.ADD_DATA_TO_MEMPOOL:
            if (
              message.to === myPeerId.toString("hex") &&
              message.from !== myPeerId.toString("hex")
            ) {
              console.log(
                "-----------ADD_DATA_TO_MEMPOOL------------- " + message.to
              );
              mempool = [...mempool, ...message.data];
              console.log(JSON.stringify(mempool));
              console.log(
                "-----------ADD_DATA_TO_MEMPOOL------------- " + message.to
              );
            }
            break;

          case MessageType.RESET_MEMPOOL:
            console.log("-----------RESET_MEMPOOL------------- " + message.to);
            mempool = [];
            console.log("-----------RESET_MEMPOOL------------- " + message.to);
            break;

          case MessageType.REQUEST_SPECIFIC_BLOCK:
            if (nodeType === "fullNode") {
              console.log("-----------REQUEST_SPECIFIC_BLOCK-------------");
              let index = message.data;
              let requestedSpecificBlock = chain.getBlock(index);
              writeMessageToPeerToId(
                peerId.toString("hex"),
                MessageType.SEND_SPECIFIC_BLOCK,
                requestedSpecificBlock || null
              );
              console.log("-----------REQUEST_SPECIFIC_BLOCK-------------");
            }
            break;
          case MessageType.SEND_SPECIFIC_BLOCK:
            console.log("-----------SEND_SPECIFIC_BLOCK-------------");
            if (message.data) {
              pendingRequestedBlock = message.data;
              return console.log(JSON.stringify(message.data));
            }

            console.log("-----------SEND_SPECIFIC_BLOCK-------------");
            break;
        }
      } catch (error) {
        // If JSON.parse fails, it means the data is incomplete, so we wait for more chunks
        if (error instanceof SyntaxError) {
          // Do nothing, just accumulate more chunks
        } else {
          console.error("Failed to parse JSON:", error);
          // Clear the buffer on non-SyntaxError
          dataBuffer = "";
        }
      }
    });

    // Close event, will indicate losing connection with other peers,
    // so deleting current peer from our peers object.

    conn.on("close", () => {
      console.log(`Connection ${seq} closed, peerId: ${peerId}`);
      if (peers[peerId].seq === seq) {
        delete peers[peerId];
        console.log(
          "--- blockchainNetworkState before: " +
            JSON.stringify(blockchainNetworkState)
        );
        let index = blockchainNetworkState?.findIndex((object) => {
          return object.id === peerId;
        });
        if (index > -1) blockchainNetworkState?.splice(index, 1);
        console.log(
          "--- blockchainNetworkState end: " +
            JSON.stringify(blockchainNetworkState)
        );
      }
      dataBuffer = ""; // Clear buffer on disconnect
    });

    conn.on("error", (error) => {
      console.error("Socket error:", error);
      dataBuffer = ""; // Clear buffer on error
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
const writeMessageToPeers = (type, data) => {
  for (let id in peers) {
    console.log("-------- writeMessageToPeers start -------- ");
    console.log("type: " + type + ", to: " + id);
    console.log("-------- writeMessageToPeers end ----------- ");
    sendMessage(id, type, data);
  }
};

// writeMessageToPeerToId => a method that will send the message to a specific peer ID
const writeMessageToPeerToId = (toId, type, data) => {
  for (let id in peers) {
    if (id === toId) {
      console.log("-------- writeMessageToPeerToId start -------- ");
      console.log("type: " + type + ", to: " + toId);
      console.log("-------- writeMessageToPeerToId end ----------- ");
      sendMessage(id, type, data);
    }
  }
};

// sendMessage is a generic method that we will be using to send a
// message formatted with the params that we like to pass , it includes:
// – to/from: The peer ID you are sending the message from and to
// – type: The message type
// – data: Any data you would like to share on the P2P network

const sendMessage = (id, type, data) => {
  try {
    if (!peers[id] || !peers[id].conn) {
      throw new Error(`Peer connection not found for id: ${id}`);
    }

    const message = {
      to: id,
      from: myPeerId,
      type: type,
      data: data,
    };

    const messageString = JSON.stringify(message);

    peers[id].conn.write(messageString);
  } catch (error) {
    console.error(`Failed to send message to peer ${id}:`, error);
  }
};

setTimeout(function() {
  writeMessageToPeers(MessageType.REQUEST_ALL_REGISTER_MINERS, null);
}, 5000);

// using a setTimeout function to send a message to retrieve the latest block
setTimeout(function() {
  writeMessageToPeers(MessageType.REQUEST_BLOCK, {
    index: chain.blockchain.length === 0 ? 0 : chain.getLatestBlock().index + 1,
  });
}, 500);

setTimeout(async () => {
  /// get node free disk space
  const freeSpace = await hddSpace.fetchHddInfo({ format: "gb" });

  const agent = {
    id: myPeerId.toString("hex"),
    nodeType,
    connections: peerConnections,
  };

  blockchainNetworkState?.push(agent);
  console.log("----------Register my agent --------------");
  console.log(blockchainNetworkState);
  writeMessageToPeers(MessageType.REGISTER_MINER, blockchainNetworkState);
  console.log("---------- Register my agent --------------");
}, 7000);

// \\ main // \\
const job = new CronJob("15 * * * * *", async function() {
  const agent = {
    id: myPeerId.toString("hex"),
    type: nodeType,
  };

  console.log("current agent", agent);
  let agentToMine = myPeerId.toString("hex");

  const prunedBlockchainSize = await sizeof(currentBlockchainToPrune);

  let index = 0; // first block

  lastBlockMinedBy = blockchainNetworkState?.[index]?.id;
  console.log(
    "-- REQUESTING NEW BLOCK FROM: " +
      blockchainNetworkState?.[index]?.id +
      ", index: " +
      index
  );

  console.log(
    "blockchainNetworkState Data: ",
    JSON.stringify(blockchainNetworkState),
    JSON.stringify(
      blockchainNetworkState?.[index]?.id === myPeerId.toString("hex")
    ),
    JSON.stringify(blockchainNetworkState?.[index]?.id),
    JSON.stringify(myPeerId),
    JSON.stringify(myPeerId.toString("hex"))
  );

  if (blockchainNetworkState?.length > 0 && chain.blockchain.length > 1) {
    // voting data
    const votes = await new Promise(async (resolve, reject) => {
      try {
        const result = await blockchainNetworkState?.reduce(
          async (accumulatorPromise, currentValue) => {
            const accumulator = await accumulatorPromise;

            const blockchainAgentBlocks = await chain.blockchain?.filter(
              (block, index) => {
                if (block.blockHeader.miner.id === currentValue.id) {
                  return block;
                }
              }
            );
            const blockchainAgentAddedValue = await blockchainAgentBlocks?.map(
              (block, index) => {
                const {
                  healthValue,
                  financeValue,
                  itValue,
                } = block.blockHeader.dataValue;
                return index * (3 * healthValue + 2 * financeValue + itValue);
              }
            );

            const voteValue =
              blockchainAgentAddedValue?.reduce((a, b) => a + b, 0) +
              currentValue.connections +
              1;

            const agent = {
              id: currentValue.id,
              nodeType: currentValue.nodeType,
              connections: currentValue.connections,
              voteValue: voteValue,
            };

            accumulator.push(agent);

            return accumulator;
          },
          Promise.resolve([])
        );
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    agentvotes = {
      agentId: myPeerId,
      votes: votes,
    };
    votingList.push(agentvotes);

    const agentIds = votingList.map((o) => o.id);
    const filteredVotingList = votingList.filter(
      ({ agentId }, index) => !agentIds.includes(agentId, index + 1)
    );

    let mergeAllAgentsVotes = await filteredVotingList?.reduce((acc, item) => {
      acc.push(...item.votes);
      return acc;
    }, []);

    let agentsVotesFinalValues = await mergeAllAgentsVotes?.reduce(
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

    // Find the index of the last block mined by a full node
    const lastBlockMinedByFullnode = chain.blockchain
      .slice(0)
      .reverse()
      .findIndex((item) => item.blockHeader.miner.type === "fullNode");

    // Filter the agents based on whether the last full node miner was more than 10 blocks ago
    const finalAgentVotesList =
      lastBlockMinedByFullnode > 10
        ? agentsVotesFinalValues.filter((item) => item.nodeType === "fullNode")
        : agentsVotesFinalValues;

    // Sort the agents by voteValue in descending order; if voteValue is the same, sort by id in ascending order
    const descOrderAgents = finalAgentVotesList.sort((a, b) => {
      // Compare by voteValue in descending order
      const voteComparison = parseFloat(b.voteValue) - parseFloat(a.voteValue);

      // If voteValue is the same, compare by id in ascending order
      if (voteComparison !== 0) {
        return voteComparison;
      } else {
        return a.id.localeCompare(b.id);
      }
    });

    // Get the id of the latest miner from the latest block
    const latestMinerId = chain.getLatestBlock().blockHeader.miner.id;

    // If there is more than one agent in the list, remove the latest miner from the list
    if (descOrderAgents.length > 1) {
      const currentMinerIndex = descOrderAgents.findIndex(
        (agent) => agent.id === latestMinerId
      );
      if (currentMinerIndex !== -1) {
        descOrderAgents.splice(currentMinerIndex, 1);
      }
    }

    // Determine the agent to mine the next block
    const agentToMine = descOrderAgents[0].id;

    // Log the selected miner agent, the ordered list of agents, and the current miner id
    console.log(
      "The miner agent",
      agentToMine,
      descOrderAgents,
      chain.getLatestBlock().blockHeader.miner.id
    );

    console.log(
      "miner agent hex",
      agentToMine === myPeerId.toString("hex"),
      agentToMine,
      myPeerId.toString("hex")
    );
  }

  if (agentToMine === myPeerId.toString("hex")) {
    console.log(
      "-----------creating new block || pruning blockchain -----------------"
    );
    // block creation
    let newBlock = null;

    if (
      chain.blockchain.length === 0 &&
      (initiatorMiner === null || myPeerId.toString("hex") === initiatorMiner)
    ) {
      console.log("Creating genesis block");
      newBlock = chain.getGenesisBlock(agent);
      chain.addBlock(newBlock);
      console.log("Genesis block added:", newBlock);
    } else {
      if (mempool.length > 0) {
        // check mempoolSiZE en MB
        const currentMempoolDataSize =
          Buffer.byteLength(JSON.stringify(mempool)) / Math.pow(1024, 2);
        console.log("Current mempool data size (MB):", currentMempoolDataSize);

        // check the time of the last block created per second
        const diffTimeFromLastMinedBlock =
          Math.abs(
            new Date().getTime() - chain.getLatestBlock().blockHeader.createdAt
          ) / 1000;
        console.log(
          "Time since last mined block (s):",
          diffTimeFromLastMinedBlock
        );

        // check mempoolDataSize > 1 mb && the elapsed time from last mined block = 60s
        if (currentMempoolDataSize > 1 || diffTimeFromLastMinedBlock > 60) {
          // const resultDataValue = await dataTypePredict(mempool);

          const resultDataValue = {
            healthValue: 0,
            financeValue: 0,
            itValue: 1,
          };
          console.log("Predicted data type value:", resultDataValue);

          //Create the new block with mempool data
          newBlock = await chain.generateNextBlock(
            agent,
            resultDataValue,
            mempool
          );
          console.log("New block generated:", newBlock);

          // clear mempool
          mempool = [];
          console.log("Mempool cleared");
          writeMessageToPeers(MessageType.RESET_MEMPOOL, null);
          chain.addBlock(newBlock);
          console.log("New block added to chain");

          console.log(JSON.stringify(newBlock));
          writeMessageToPeers(MessageType.RECEIVE_NEW_BLOCK, newBlock);
          votingList = [];
          console.log("New block broadcasted to peers");
        }

        const diffTime =
          new Date().getTime() - prunedBlockchainInfo.lastTimePruned;
        const diffhoursLastTimePrunnig = Math.floor(diffTime / 1000 / 60);
        console.log(
          "Time since last pruning (minutes):",
          diffhoursLastTimePrunnig
        );

        // await folderSize(dbPath, { ignoreHidden: true }, (err, data) => {
        //   if (err) {
        //     throw err;
        //   }
        //   let dbSize = data?.ldb;
        //   blockChainSize = (dbSize / Math.pow(1024, 2)).toFixed(2);
        //   console.log("Current blockchain size (MB):", blockChainSize);
        // });

        const currentPrunningBlockchainSize = (
          prunedBlockchainInfo.prunedBlockchainSize / Math.pow(1024, 2)
        ).toFixed(2);
        console.log(
          "Current pruned blockchain size (MB):",
          currentPrunningBlockchainSize
        );

        const testdiffhoursLastTimePrunnig = 1;
        const testcurrentPrunningBlockchainSize = 1;
        if (
          // (diffhoursLastTimePrunnig > 10 ||
          //   currentPrunningBlockchainSize > 10) &&
          // pruningListsMempool.length > 0

          (diffhoursLastTimePrunnig > testdiffhoursLastTimePrunnig ||
            currentPrunningBlockchainSize >
              testcurrentPrunningBlockchainSize) &&
          pruningListsMempool.length > 0

          // true &
          // (chain.blockchain?.length > 0)
        ) {
          const target_error = 1;
          const n_head_lists = 10;
          const list_eliminator_ratio = 0.9;
          const current_blockchain_size = prunedBlockchainSize;
          console.log("Starting PSO pruning");

          const pruningListmempooltest = [
            {
              agentId: agent.id,
              alpha: 1,
              y: 1,
              prunedBlockchainSize: 1,
              pruningData: iotData,
            },
          ];

          psoList = pso(
            target_error,
            // pruningListsMempool,
            pruningListmempooltest,
            list_eliminator_ratio,
            n_head_lists,
            // current_blockchain_size
            1
          );
          // const perfWrapper = performance.timerify(
          //   pso(
          //     target_error,
          //     pruningListsMempool,
          //     list_eliminator_ratio,
          //     n_head_lists,
          //     current_blockchain_size
          //   )
          // );

          // console.log("Pruning list:", JSON.stringify(psoList));

          // perfWrapper();
          console.log("psoList", psoList);
          if (psoList) {
            const newPrunedblockchain = currentBlockchainToPrune.map(
              (block) => {
                const prunedBlock = { ...block };
                Object.keys(prunedBlock).forEach((key) => {
                  if (psoList.pruningData.includes(key))
                    delete prunedBlock[key];
                });
                return prunedBlock;
              }
            );
            console.log("New pruned blockchain created");

            const newPrunedBlockchainSize = await sizeof(newPrunedblockchain);
            console.log("New pruned blockchain size calculated");

            prunedBlockchainInfo = {
              prunerId: agent?.id,
              choosedList: psoList,
              prunedBlockchainSize: newPrunedBlockchainSize,
              lastTimePruned: new Date().getTime(),
              data: newPrunedblockchain,
            };
            console.log(
              "Pruned blockchain info updated:",
              prunedBlockchainInfo
            );
            writeMessageToPeers(
              MessageType.RECEIVE_PRUNED_BLOCKCHAIN,
              prunedBlockchainInfo
            );
            console.log("Pruned blockchain broadcasted to peers");
          }
        }

        console.log("Current blockchain:", JSON.stringify(chain.blockchain));
        console.log(
          "-----------creating new block || pruning blockchain -----------------"
        );
      }
      setTimeout(function() {
        console.log("CURRENT ABISCHAIN BLOCKCHAIN STATE", chain.blockchain);
      }, 5000);
    }
  }
});
job.start();

process.on("SIGINT", async () => {
  console.log("Leaving the Abischain network.");
  redisClient.flushdb(function(err, succeeded) {
    console.log("redis cache cleaned successfully", succeeded);
    process.exit();
  });
});

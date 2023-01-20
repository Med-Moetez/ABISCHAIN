// env variables
require("dotenv").config();
//hdd space
const hddSpace = require("hdd-space");
//apis
const apis = require("./apis");
const process = require("node:process");
const crypto = require("crypto");

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
const axios = require("axios");

//peer caching system
const Redis = require("redis");
const utils = require("./utlis");

// our variables of network peers and connection sequence
const peers = {};
let connSeq = 0;
let channel = "myBlockchain";
let registeredMiners = [];
let initiatorMiner = null;
let lastBlockMinedBy = null;
const redisClient = Redis.createClient({
  host: "localhost",
  port: 6379,
});

// define a message type to request and receive the latest block
let MessageType = {
  REQUEST_BLOCK: "requestBlock",
  RECEIVE_NEXT_BLOCK: "receiveNextBlock",
  RECEIVE_NEW_BLOCK: "receiveNewBlock",
  REQUEST_ALL_REGISTER_MINERS: "requestAllRegisterMiners",
  REGISTER_MINER: "registerMiner",
};

const myPeerId = crypto.randomBytes(32);
chain.createDb(myPeerId.toString("hex"));
console.log("myPeerId: " + myPeerId.toString("hex"));

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

    const redisKeys = await utils.getRedisKeys(redisClient);
    Promise.all(
      redisKeys.map((key) => {
        return new Promise((resolve, reject) => {
          redisClient.get(key, async (error, data) => {
            if (error) return reject(error);
            if (data != null) {
              return resolve(JSON.parse(data));
            }
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
    });
    res.send(chain.blockchain[blockIndex]);
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
    res.send(chain.deepCheckValid(chain.blockchain));
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
    console.log(`Connected #${seq} to peer: ${peerId}`);

    if (info.initiator) {
      try {
        initiatorMiner = myPeerId.toString("hex");
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
          mainBlockchain = chain.blockchain;
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

            if (chain.checkEmptyDb && chain.blockchain.length > 0) {
              chain.addChainBlocks(chain.blockchain);
              chain.addBlock(JSON.parse(JSON.stringify(message.data)));
            } else {
              chain.addBlock(JSON.parse(JSON.stringify(message.data)));
            }
            console.log(JSON.stringify(chain.blockchain));
            console.log(
              "-----------RECEIVE_NEW_BLOCK------------- " + message.to
            );
          }
          break;

        case MessageType.REQUEST_ALL_REGISTER_MINERS:
          console.log(
            "-----------REQUEST_ALL_REGISTER_MINERS------------- " + message.to
          );
          writeMessageToPeers(MessageType.REGISTER_MINER, registeredMiners);
          registeredMiners = JSON.parse(JSON.stringify(message.data));
          console.log(
            "-----------REQUEST_ALL_REGISTER_MINERS------------- " + message.to
          );
          break;

        case MessageType.REGISTER_MINER:
          console.log("-----------REGISTER_MINER------------- " + message.to);
          let miners = JSON.stringify(message.data);
          registeredMiners = JSON.parse(miners);
          console.log(registeredMiners);
          console.log("-----------REGISTER_MINER------------- " + message.to);
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
          "--- registeredMiners before: " + JSON.stringify(registeredMiners)
        );
        let index = registeredMiners.findIndex((object) => {
          return object.id === peerId;
        });
        if (index > -1) registeredMiners.splice(index, 1);
        console.log(
          "--- registeredMiners end: " + JSON.stringify(registeredMiners)
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
  const freeSpace = await hddSpace.fetchHddInfo({ format: "gb" });

  let nodeType =
    parseInt(freeSpace?.total?.free) > 100 ? "fullNode" : "lightNode";

  registeredMiners.push({ id: myPeerId.toString("hex"), nodeType });
  console.log("----------Register my miner --------------");
  console.log(registeredMiners);
  writeMessageToPeers(MessageType.REGISTER_MINER, registeredMiners);
  console.log("---------- Register my miner --------------");
}, 7000);

const job = new CronJob("15 * * * * *", async function() {
  let index = 0; // first block

  // requesting next block from your next miner
  if (lastBlockMinedBy) {
    let newIndex = registeredMiners.indexOf(lastBlockMinedBy);
    index = newIndex + 1 > registeredMiners.length - 1 ? 0 : newIndex + 1;
  }

  // To generate and add a new block, we will call chain
  // generateNextBlock and addBlock. Lastly, we will broadcast the new
  // block to all the connected peers.

  lastBlockMinedBy = registeredMiners[index];
  console.log(
    "-- REQUESTING NEW BLOCK FROM: " +
      registeredMiners[index] +
      ", index: " +
      index
  );
  console.log(
    JSON.stringify(
      registeredMiners,
      registeredMiners[index] === myPeerId.toString("hex"),
      registeredMiners[index],
      myPeerId.toString("hex")
    )
  );

  if (registeredMiners[index] === myPeerId.toString("hex")) {
    console.log("-----------create next block -----------------");
    // block creation
    let newBlock = null;
    if (
      chain.blockchain.length === 0 &&
      (initiatorMiner === null || myPeerId.toString("hex") === initiatorMiner)
    ) {
      newBlock = chain.getGenesisBlock();
      chain.storeBlock(newBlock);
    } else {
      const randomApi = utils.generateRandom(
        0,
        Object.values(apis.APIS).length
      );
      const data = await axios.get(
        process.env.BASE_URL +
          Object.values(apis.APIS)[randomApi] +
          `?size=${randomApi}`
      );

      newBlock = chain.generateNextBlock(data?.data);
    }
    chain.addBlock(newBlock);
    console.log(JSON.stringify(newBlock));
    writeMessageToPeers(MessageType.RECEIVE_NEW_BLOCK, newBlock);
    console.log(JSON.stringify(chain.blockchain));
    console.log("-----------create next block -----------------");
  }
  // display current blockchain state
  setTimeout(function() {
    console.log("CURRENT ABISCHAIN BLOCKCHAIN  STATE", chain.blockchain);
  }, 5000);
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

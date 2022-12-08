require("dotenv").config();
const { dataSetGenerate, search, getDataset } = require("data-search");

// redis func
const getOrSetCache = (redisClient, key, cb) => {
  return new Promise((resolve, reject) => {
    redisClient.get(key, async (error, data) => {
      if (error) return reject(error);
      if (data != null) {
        return resolve(JSON.parse(data));
      }
      const freshData = await cb();
      redisClient.setex(
        key,
        process.env.DEFAULT_EXPIRATION_REDIS,
        JSON.stringify(freshData)
      );
      resolve(freshData);
    });
  });
};

const getRedisKeys = (redisClient) => {
  return new Promise((resolve, reject) => {
    redisClient.keys("*", (err, keys) => {
      if (err) return reject(err);
      return resolve(keys);
    });
  });
};

const generateActiveData = async (item, blockchain) => {
  const attributesInfo = getDataset();
  const datasetResult = dataSetGenerate({
    array: blockchain,
    attributes: attributesInfo,
  });

  const searchedItem = item;

  const res = search(datasetResult, searchedItem);
  return res;
};

const generateRandom = (min, max) => {
  // find diff
  let difference = max - min;

  // generate random number
  let rand = Math.random();

  // multiply with difference
  rand = Math.floor(rand * difference);

  // add with min value
  rand = rand + min;

  return rand;
};

exports.getOrSetCache = getOrSetCache;
exports.getRedisKeys = getRedisKeys;
exports.generateActiveData = generateActiveData;
exports.generateRandom = generateRandom;


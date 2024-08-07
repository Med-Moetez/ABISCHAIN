//env
require("dotenv").config();

//axios
const axios = require("axios");

//apis
const apis = require("./apis");

// data search package
const { dataSetGenerate, search, getDataset } = require("data-search");

// redis func
// const getOrSetCache = (redisClient, key, cb) => {
//   return new Promise((resolve, reject) => {
//     redisClient.get(key, async (error, data) => {
//       if (error) return reject(error);
//       if (data != null) {
//         return resolve(JSON.parse(data));
//       }

//       try {
//         const freshData = await cb();
//         redisClient.setex(
//           key,
//           process.env.DEFAULT_EXPIRATION_REDIS,
//           JSON.stringify(freshData)
//         );
//         resolve(freshData);
//       } catch (error) {
//         reject(error);
//       }
//     });
//   });
// };

const getOrSetCache = async (redisClient, key, fetchFunction) => {
  const cachedData = await getCache(redisClient, key);
  if (cachedData !== null) {
    return JSON.parse(cachedData);
  }
  const newData = await fetchFunction();
  await setCache(redisClient, key, JSON.stringify(newData));
  return newData;
};
const getCache = async (redisClient, key) => {
  return new Promise((resolve, reject) => {
    redisClient.get(key, (error, data) => {
      if (error) return reject(error);
      resolve(data);
    });
  });
};
const setCache = async (redisClient, key, value) => {
  return new Promise((resolve, reject) => {
    redisClient.set(key, value, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
};
const getRedisKeys = (redisClient) => {
  return new Promise((resolve, reject) => {
    redisClient.keys("*", (err, keys) => {
      if (err) return reject(err);
      resolve(keys);
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

const fetchFakeData = async () => {
  const randomApi = generateRandom(0, Object.values(apis.APIS).length);
  const data = await axios.get(
    process.env.BASE_URL +
      Object.values(apis.APIS)[randomApi] +
      `?size=${randomApi}`
  );
  return data?.data;
};

const difference = (a, b) => {
  return a - b;
};

const getObjectKey = (obj, value) => {
  return Object.keys(obj).find((key) => obj[key] === value);
};

exports.getOrSetCache = getOrSetCache;
exports.getCache = getCache;
exports.setCache = setCache;
exports.getRedisKeys = getRedisKeys;
exports.generateActiveData = generateActiveData;
exports.generateRandom = generateRandom;
exports.fetchFakeData = fetchFakeData;
exports.difference = difference;
exports.getObjectKey = getObjectKey;

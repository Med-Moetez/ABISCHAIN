// data classifier ==> classify text using n-grams and cosine similarity.
const { Classifier } = require("ml-classify-text");
const { healthData, financeData, ITData } = require("./TrainingData/index");
const utils = require("./utlis");
// by word if value min max is equal to 1
//  {
// nGramMin: 1,
// nGramMax: 1,
// }

const classifier = new Classifier();

//classifier.train(input, label)
classifier.train(healthData, "Health");
classifier.train(financeData, "Finance");
classifier.train(ITData, "IT");

const dataTypePredict = async (data) => {
  let result = {
    healthValue: 0,
    financeValue: 0,
    itValue: 0,
  };
  const dataToString = JSON.stringify(data);
  if (dataToString === "{}") return result;

  //classifier.predict(input, [maxMatches]=1, [minimumConfidence]=0.2)
  const predictions = classifier.predict(dataToString);

  if (predictions.length) {
    predictions.forEach((prediction) => {
      prediction.label === "Health"
        ? (result["healthValue"] = prediction.confidence)
        : prediction.label === "Finance"
        ? (result["financeValue"] = prediction.confidence)
        : prediction.label === "IT"
        ? (result["itValue"] = prediction.confidence)
        : null;
    });

    const { healthValue, financeValue, itValue } = result;

    // retrain on new data
    const minimumDiff = 0.8;
    utils.difference(healthValue, financeValue);
    if (
      (utils.difference(healthValue, financeValue) > minimumDiff &&
        utils.difference(healthValue, itValue) > minimumDiff) ||
      (utils.difference(financeValue, healthValue) > minimumDiff &&
        utils.difference(financeValue, itValue) > minimumDiff) ||
      (utils.difference(itValue, healthValue) > minimumDiff &&
        utils.difference(itValue, financeValue) > minimumDiff)
    ) {
      // largest value
      const largest = Math.max(healthValue, financeValue, itValue);
      // get largest value training label eg. health, finance...
      const ModelToTrain = utils.getObjectKey(result, largest);
      //new training data
      const newTrainingData = await Object.keys(data).reduce(function(r, k) {
        return r.concat(k, data[k]);
      }, []);
      classifier.train(newTrainingData, ModelToTrain);
    }
  }

  return result;
};

module.exports = { dataTypePredict };

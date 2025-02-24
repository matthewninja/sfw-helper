import 'babel-polyfill';
import * as tf from '@tensorflow/tfjs';
import { NSFW_CLASSES } from './nsfw_classes';

let MOBILENET_MODEL_PATH = 'nsfwjs/model.json';
let IMAGE_SIZE = 299; // change this
let TOPK_PREDICTIONS = 5; // top 10 predictions. will be mapped to logits (probability/confidence)

class BackgroundProcessing {

  constructor() {
    this.imageRequests = {};
    this.addListeners();
    this.loadModel();
  }

  addListeners() {
    chrome.webRequest.onCompleted.addListener(req => {
      if (req && req.tabId > 0) {
        this.imageRequests[req.url] = this.imageRequests[req.url] || req;
        this.analyzeImage(req.url);
      }
    }, { urls: ["<all_urls>"], types: ["image", "object"] });
  }

  async loadModel() {
    console.log('Loading model...');
    let startTime = performance.now();
    this.model = await tf.loadModel(MOBILENET_MODEL_PATH);
    this.model.predict(tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3])).dispose();

    let totalTime = Math.floor(performance.now() - startTime);
    console.log(`Model loaded and initialized in ${totalTime}ms...`);
  }

  async loadImage(src) {
    return new Promise(resolve => {
      let img = document.createElement('img');
      img.crossOrigin = "anonymous";
      img.onerror = function(e) {
        resolve(null);
      };
      img.onload = function(e) {
        // if ((img.height && img.height > 128) || (img.width && img.width > 128)) {
          // Set image size for tf!
          img.width = IMAGE_SIZE;
          img.height = IMAGE_SIZE;
          resolve(img);
        // }
        // Let's skip all tiny images
        // resolve(null);
      }
      img.src = src;
    });
  }

  async getTopKClasses(logits, topK) {
    let values = await logits.data();
    let valuesAndIndices = [];
    for (let i = 0; i < values.length; i++) {
      valuesAndIndices.push({value: values[i], index: i});
    }
    valuesAndIndices.sort((a, b) => {
      return b.value - a.value;
    });
    let topkValues = new Float32Array(topK);
    let topkIndices = new Int32Array(topK);
    for (let i = 0; i < topK; i++) {
      topkValues[i] = valuesAndIndices[i].value;
      topkIndices[i] = valuesAndIndices[i].index;
    }

    const topClassesAndProbs = [];
    for (let i = 0; i < topkIndices.length; i++) {
      topClassesAndProbs.push({
        // className: IMAGENET_CLASSES[topkIndices[i]],
        className: NSFW_CLASSES[topkIndices[i]],
        probability: topkValues[i]
      })
    }
    return topClassesAndProbs;
  }


  async predict(imgElement) {
    const startTime = performance.now();
    const logits = tf.tidy(() => {
      const img = tf.fromPixels(imgElement).toFloat();
      const offset = tf.scalar(127.5);
      const normalized = img.sub(offset).div(offset);
      const batched = normalized.reshape([1, IMAGE_SIZE, IMAGE_SIZE, 3]);
      return this.model.predict(batched);
    });

    // Convert logits to probabilities and class names.
    const predictions = await this.getTopKClasses(logits, TOPK_PREDICTIONS);
    const totalTime = Math.floor(performance.now() - startTime);
    return predictions;
  }

  async analyzeImage(src) {

    if (!this.model) {
      setTimeout(() => { this.analyzeImage(src) }, 5000);
      return;
    }

    var meta = this.imageRequests[src];
    if (meta && meta.tabId) {
      if (!meta.predictions) {
        const img = await this.loadImage(src);
        if (img) {
          meta.predictions = await this.predict(img);
        }
      }

      if (meta.predictions) {
        chrome.tabs.sendMessage(meta.tabId, {
          action: 'IMAGE_PROCESSED',
          payload: meta,
        });
      }
    }
  }
}

var bg = new BackgroundProcessing();

// // image to change to
// // TODO: make a list of images and maybe randomize which image is chosen
// // TODO: have images stored locally instead of requesting it from imgur
// const baseUrl = "https://i.imgur.com/QRPzNTS.jpg";

// // let safePicsArr = ["./images/cat1.jpg", "./images/cat2.jpg", "./images/cat3.jpg"]

// chrome.runtime.onMessage.addListener(function(message, sender, senderResponse){
//   if(message.msg === "image"){
    
//     // var baseUrl = safePicsArr[Math.floor(Math.random()*safePicsArr.length)];
//     senderResponse({data: baseUrl, index: message.index});
//     // fetch('https://some-random-api.ml/pikachuimg')
//     //       .then(response => response.text())
//     //       .then(data => {
//     //         let dataObj = JSON.parse(data);
//     //         senderResponse({data: dataObj, index: message.index});
//     //       })
//     //       .catch(error => console.log("error", error))
//       return true;  // Will respond asynchronously.
//   }
// });
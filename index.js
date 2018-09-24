const Web3 = require('web3');
const rlay = require('@rlay/web3-rlay');
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ipfsAPI = require('ipfs-api');

const address = '0xc02345a911471fd46c47c4d3c2e5c85f5ae93d13';
const indexPath = '/Users/hobofan/stuff/hobofan-crates.io-index';

const web3 = new Web3(process.env.RPC_URL || 'http://localhost:8546');
rlay.extendWeb3WithRlay(web3);
web3.eth.defaultAccount = address;

const storeEntity = entity => {
  return rlay.store(web3, entity, { gas: 1000000 });
};

const retrieve = cid => {
  return rlay.retrieve(web3, cid);
};

const seedOntology = async () => {
  const urlLabel = await storeEntity({
    type: 'Annotation',
    property: rlay.builtins.labelAnnotationProperty,
    value: rlay.encodeValue('Univeral Resource Location'),
  });
  const urlAnnotationProperty = await storeEntity({
    type: 'AnnotationProperty',
    annotations: [urlLabel],
  });

  const Sha256ChecksumLabel = await storeEntity({
    type: 'Annotation',
    property: rlay.builtins.labelAnnotationProperty,
    value: rlay.encodeValue('SHA256 checksum'),
  });
  const sha256Checksum = await storeEntity({
    type: 'AnnotationProperty',
    annotations: [Sha256ChecksumLabel],
  });

  const alternativeUrlLabel = await storeEntity({
    type: 'Annotation',
    property: rlay.builtins.labelAnnotationProperty,
    value: rlay.encodeValue('Alternative URL'),
  });
  const alternativeUrl = await storeEntity({
    type: 'DataProperty',
    annotations: [alternativeUrlLabel],
  });

  return {
    urlAnnotationProperty,
    sha256Checksum,
    alternativeUrl,
  };
};

const getChecksum = (indexPath, crateName, crateVersion) => {
  let crateDir;
  if (crateName.length === 1 || crateName.length === 2) {
    crateDir = crateName;
  } else if (crateName.length === 3) {
    crateDir = `3/${crateName.slice(0, 1)}`;
  } else {
    crateDir = `${crateName.slice(0, 2)}/${crateName.slice(2, 4)}`;
  }

  const fileName = path.join(indexPath, crateDir, crateName);

  return new Promise((resolve, reject) => {
    const instream = fs.createReadStream(fileName);
    const rl = readline.createInterface({ input: instream });

    const linesArray = [];

    rl.on('line', function(line) {
      linesArray.push(line);
    });

    rl.on('close', function() {
      const linesArrayObjs = linesArray.map(JSON.parse);
      const versionLine = linesArrayObjs.find(n => n.vers === crateVersion);
      resolve(versionLine.cksum);
    });
  });
};

const urlChecksumIndividual = async (ontology, url, cksum) => {
  const urlAnn = await storeEntity({
    type: 'Annotation',
    property: ontology.urlAnnotationProperty,
    value: rlay.encodeValue(url),
  });
  const cksumAnn = await storeEntity({
    type: 'Annotation',
    property: ontology.sha256Checksum,
    value: rlay.encodeValue(cksum),
  });
  const individual = await storeEntity({
    type: 'Individual',
    annotations: [urlAnn, cksumAnn],
  });
  return individual;
};

const listAlternativeUrls = async (ontology, individual) => {
  const cids = await web3.rlay.experimentalListCidsIndex(
    'DataPropertyAssertion',
    'subject',
    individual,
  );
  const alternatives = await Promise.all(cids.map(retrieve));
  const alternativeUrls = alternatives
    .filter(n => n.target)
    .map(n => rlay.decodeValue(n.target));

  return alternativeUrls;
};

const addAlternativeUrl = (ontology, individual, url) => {
  return storeEntity({
    type: 'DataPropertyAssertion',
    subject: individual,
    property: ontology.alternativeUrl,
    target: rlay.encodeValue(url),
  });
};

const getIpfsAlternative = (ontology, originalIndividual) => {
  return listAlternativeUrls(ontology, originalIndividual).then(
    alternativeUrls => {
      return alternativeUrls.find(n =>
        n.startsWith('http://localhost:8080/ipfs'),
      );
    },
  );
};

const addIpfsAlternative = async (ontology, originalIndividual, dlUrl) => {
  const addToIpfs = url => {
    const ipfs = ipfsAPI('/ip4/127.0.0.1/tcp/5001');

    return new Promise((resolve, reject) => {
      console.log(url);
      ipfs.util.addFromURL(url, (err, result) => {
        if (err) {
          throw err;
        }
        resolve(result[0].hash);
      });
    });
  };

  const alternativeHash = await addToIpfs(dlUrl);
  const alternativeUrl = `http://localhost:8080/ipfs/${alternativeHash}`;
  return addAlternativeUrl(ontology, originalIndividual, alternativeUrl);
};

const startServer = ontology => {
  const app = express();
  const port = 3050;

  const mainDlUrl = 'https://crates.io/api/v1/crates';

  app.get('/crates/api/v1/crates/:name/:version/download', (req, res) => {
    const crateName = req.params.name;
    const crateVersion = req.params.version;

    let dlUrl = `${mainDlUrl}/${crateName}/${crateVersion}/download`;

    getChecksum(indexPath, crateName, crateVersion).then(cksum => {
      urlChecksumIndividual(ontology, dlUrl, cksum).then(individual => {
        getIpfsAlternative(ontology, individual).then(alternative => {
          const usedDlUrl = alternative || dlUrl;
          console.log('Download URL', usedDlUrl, !!alternative);
          res.redirect(302, usedDlUrl);
          if (!alternative) {
            addIpfsAlternative(ontology, individual, dlUrl);
          }
        });
      });
    });
    // .then(individual => {
    // addAlternativeUrl(ontology, individual, dlUrl);
    // return listAlternativeUrls(ontology, individual);
    // })
    // .then(alternativeUrls => {
    // console.log(alternativeUrls);
    // });
  });

  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
};

const main = async () => {
  const ontology = await seedOntology();

  startServer(ontology);
};

main();

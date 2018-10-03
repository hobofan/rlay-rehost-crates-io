const Web3 = require('web3');
const rlay = require('@rlay/web3-rlay');
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ipfsAPI = require('ipfs-api');

const address = '0xc02345a911471fd46c47c4d3c2e5c85f5ae93d13';
const indexPath = '/Users/hobofan/stuff/hobofan-crates.io-index';

const ontology = require('./build/main-seeded.json');

const web3 = new Web3(process.env.RPC_URL || 'http://localhost:8546');
rlay.extendWeb3WithRlay(web3);
web3.eth.defaultAccount = address;

const storeEntity = entity => {
  return rlay.store(web3, entity, { gas: 1000000 });
};

const getEntityCid = entity => {
  return web3.rlay.experimentalGetEntityCid(entity);
};

const retrieve = cid => {
  return rlay.retrieve(web3, cid);
};

const getChecksum = (indexPath, crateName, crateVersion) => {
  let crateDir;
  if (crateName.length === 1 || crateName.length === 2) {
    crateDir = crateName.length.toString();
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

const getUrlChecksumIndividual = async (ontology, url, cksum) => {
  const urlAnn = await getEntityCid({
    type: 'Annotation',
    property: ontology.urlAnnotationProperty,
    value: rlay.encodeValue(url),
  });
  const cksumAnn = await getEntityCid({
    type: 'Annotation',
    property: ontology.sha256Checksum,
    value: rlay.encodeValue(cksum),
  });
  const individual = await getEntityCid({
    type: 'Individual',
    annotations: [urlAnn, cksumAnn],
  });
  return individual;
};

const storeUrlChecksumIndividual = async (ontology, url, cksum) => {
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
  const port = 23788;

  const mainDlUrl = 'https://crates.io/api/v1/crates';

  app.get('/crates/api/v1/crates/:name/:version/download', (req, res) => {
    const crateName = req.params.name;
    const crateVersion = req.params.version;

    let dlUrl = `${mainDlUrl}/${crateName}/${crateVersion}/download`;

    getChecksum(indexPath, crateName, crateVersion).then(cksum => {
      getUrlChecksumIndividual(ontology, dlUrl, cksum).then(individual => {
        getIpfsAlternative(ontology, individual).then(alternative => {
          const usedDlUrl = alternative || dlUrl;
          console.log('Download URL', usedDlUrl, !!alternative);
          res.redirect(302, usedDlUrl);
          if (!alternative) {
            storeUrlChecksumIndividual(ontology, dlUrl, cksum).then(
              individual => {
                return addIpfsAlternative(ontology, individual, dlUrl);
              },
            );
          }
        });
      });
    });
  });

  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
};

const main = async () => {
  startServer(ontology);
};

main();

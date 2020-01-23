const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ipfsAPI = require('ipfs-api');
const CID = require('cids');
const castArray = require('lodash.castarray');

const rlayClient = require('../ontology/generated/rlay-client');

const indexPath = '/Users/hobofan/stuff/hobofan-crates.io-index';

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

const buildUrlChecksumIndividual = async (url, cksum) => {
  const payload = new rlayClient.SchemaPayload(rlayClient, {
    urlAnnotationProperty: url,
    sha256Checksum: cksum,
  });
  const individual = rlayClient.getEntityFromPayload(
    payload.toIndividualEntityPayload(),
  );

  return individual;
};

const storeUrlChecksumIndividual = async (url, cksum) => {
  const individual = await rlayClient.Individual.create({
    urlAnnotationProperty: url,
    sha256Checksum: cksum,
  });
  return individual;
};

const listAlternativeUrls = async individual => {
  await individual.resolve();
  let alternativeUrls = castArray(individual.alternativeUrl);
  alternativeUrls = alternativeUrls.filter(Boolean);

  console.log('Alternative URLs', alternativeUrls);

  return alternativeUrls;
};

const addAlternativeUrl = (individual, url) => {
  return individual.assert({ alternativeUrl: url });
};

const getIpfsAlternative = async originalIndividual => {
  const alternativeUrls = await listAlternativeUrls(originalIndividual);
  let alternativeUrl = alternativeUrls.find(n => n.startsWith('ipfs://'));
  if (!alternativeUrl) {
    return null;
  }

  return alternativeUrl.replace('ipfs://', 'http://localhost:8080/ipfs/');
};

const addIpfsAlternative = async (originalIndividual, dlUrl) => {
  const addToIpfs = url => {
    const ipfs = ipfsAPI('/ip4/127.0.0.1/tcp/5001');

    return new Promise((resolve, reject) => {
      console.log('Adding remote URL', url, 'to IPFS');
      ipfs.util.addFromURL(url, (err, result) => {
        if (err) {
          throw err;
        }
        console.log('Finished adding remote URL', url, 'to IPFS');

        const cid = new CID(result[0].hash);
        const base32cid = cid.toV1().toString('base32');
        resolve(base32cid);
      });
    });
  };

  const alternativeHash = await addToIpfs(dlUrl);
  const alternativeUrl = `ipfs://${alternativeHash}`;
  return addAlternativeUrl(originalIndividual, alternativeUrl);
};

const startServer = async () => {
  const app = express();
  const port = 23788;

  const mainDlUrl = 'https://crates.io/api/v1/crates';

  app.get('/crates/api/v1/crates/:name/:version/download', async (req, res) => {
    const crateName = req.params.name;
    const crateVersion = req.params.version;

    let dlUrl = `${mainDlUrl}/${crateName}/${crateVersion}/download`;

    const cksum = await getChecksum(indexPath, crateName, crateVersion);
    const individual = await buildUrlChecksumIndividual(dlUrl, cksum);
    console.log(individual);
    const alternative = await getIpfsAlternative(individual);

    const usedDlUrl = alternative || dlUrl;
    console.log('Download URL', usedDlUrl, !!alternative);
    res.redirect(302, usedDlUrl);
    if (!alternative) {
      const storedIndividual = await storeUrlChecksumIndividual(dlUrl, cksum);

      return addIpfsAlternative(storedIndividual, dlUrl);
    }
  });

  app.get('/cargo-rlay-fetch/:name/:version/alternatives', async (req, res) => {
    const crateName = req.params.name;
    const crateVersion = req.params.version;

    let dlUrl = `${mainDlUrl}/${crateName}/${crateVersion}/download`;

    const cksum = await getChecksum(indexPath, crateName, crateVersion);
    const individual = await buildUrlChecksumIndividual(dlUrl, cksum);
    const alternative = await getIpfsAlternative(individual);

    const alternatives = [];
    alternatives.push({
      url: dlUrl,
      weight: 1,
    });
    if (alternative) {
      alternatives.push({
        url: alternative,
        weight: 10,
      });
    }

    res.status(200).send(
      JSON.stringify(
        {
          alternatives,
        },
        null,
        4,
      ),
    );
    if (!alternative) {
      const storedIndividual = await storeUrlChecksumIndividual(dlUrl, cksum);
      return addIpfsAlternative(storedIndividual, dlUrl);
    }
  });

  app.listen(port, () => console.log(`Example app listening on port ${port}!`));
};

const main = async () => {
  startServer();
};

main();

const rlay = require('@rlay/web3-rlay');

const label = value => ({
  type: 'Annotation',
  property: '*labelAnnotationProperty',
  value,
});

module.exports = {
  version: '2',
  imports: {
    ...rlay.builtins,
  },
  entities: {
    urlLabel: label('Univeral Resource Location'),
    urlAnnotationProperty: {
      type: 'AnnotationProperty',
      annotations: ['*urlLabel'],
    },

    Sha256ChecksumLabel: label('SHA256 checksum'),
    sha256Checksum: {
      type: 'AnnotationProperty',
      annotations: ['*Sha256ChecksumLabel'],
    },

    alternativeUrlLabel: label('Alternative URL'),
    alternativeUrl: {
      type: 'DataProperty',
      annotations: ['*alternativeUrlLabel'],
    },
  },
};

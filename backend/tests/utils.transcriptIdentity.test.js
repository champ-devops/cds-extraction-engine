import { expect } from 'chai';
import { STT_EN_TRANSCRIPT_IDENTITY, TranscriptDirection, TranscriptVariant } from '../src/utils/transcriptIdentity.js';

describe('transcriptIdentity constants', () => {
  it('defines expected direction and variant enums', () => {
    expect(TranscriptDirection.STT).to.equal('STT');
    expect(TranscriptDirection.TTS).to.equal('TTS');
    expect(TranscriptVariant.STT_EN).to.equal('EN');
    expect(TranscriptVariant.TTS_DA_EN).to.equal('DA_EN');
  });

  it('defines frozen STT EN identity payload', () => {
    expect(STT_EN_TRANSCRIPT_IDENTITY).to.deep.equal({ direction: 'STT', variant: 'EN' });
    expect(Object.isFrozen(STT_EN_TRANSCRIPT_IDENTITY)).to.equal(true);
  });
});

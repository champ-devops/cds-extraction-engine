export const TranscriptDirection = Object.freeze({
  STT: 'STT',
  TTS: 'TTS'
});

export const TranscriptVariant = Object.freeze({
  STT_EN: 'EN',
  TTS_DA_EN: 'DA_EN'
});

export const STT_EN_TRANSCRIPT_IDENTITY = Object.freeze({
  direction: TranscriptDirection.STT,
  variant: TranscriptVariant.STT_EN
});

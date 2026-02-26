import { expect } from 'chai';
import {
  buildEventMediaContext,
  buildEventKeyTerms,
  extractEventAndItemsRowsFromFullEvent,
  extractPrimaryMediaFromFullEvent,
  extractProperNounsFromTextsWithMeta,
  extractRawHintTextsFromFullEvent
} from '../src/services/eventHints.js';

describe('eventHints service', () => {
  it('extractPrimaryMediaFromFullEvent returns first matching non-deleted media', () => {
    const result = extractPrimaryMediaFromFullEvent({
      media: [
        { mediaClassID: 4, mediaTypeID: 1, deletedDateTimeUTC: '2025-01-01', customerMediaID: 1, mediaFileLocation: 'x', mediaFileName: 'x.mp4' },
        { mediaClassID: 4, mediaTypeID: 1, deletedDateTimeUTC: null, customerMediaID: 2, mediaFileLocation: 'a', mediaFileName: 'a.mp4' },
        { mediaClassID: 4, mediaTypeID: 1, deletedDateTimeUTC: null, customerMediaID: 3, mediaFileLocation: 'b', mediaFileName: 'b.mp4' }
      ]
    });

    expect(result).to.deep.equal({
      customerMediaID: 2,
      mediaPath: 'a/a.mp4'
    });
  });

  it('extractEventAndItemsRowsFromFullEvent collects event/agenda/timeline rows', () => {
    const result = extractEventAndItemsRowsFromFullEvent({
      title: 'City Council Meeting',
      description: 'Regular session',
      customerEventID: 1175,
      timeline: [
        { customerTimelineItemID: 301, externalID: '', title: 'Timeline One' },
        { customerTimelineItemID: 302, externalID: 'VOTING_ACTIVITY_IMPORT::1', title: 'Imported Timeline' },
        { externalID: '', title: '  ' }
      ],
      agenda: [
        { customerAgendaItemID: 101, title: 'Agenda One', description: 'Agenda description' },
        { customerAgendaItemID: 102, title: 'Agenda Two', description: '' }
      ]
    });

    expect(result).to.deep.equal([
      {
        sourceType: 'EVENT',
        sourceID: '1175',
        title: 'City Council Meeting',
        description: 'Regular session',
        externalID: '',
        textOriginal: 'City Council Meeting. Regular session'
      },
      {
        sourceType: 'AGENDA_ITEM',
        sourceID: '101',
        title: 'Agenda One',
        description: 'Agenda description',
        externalID: '',
        textOriginal: 'Agenda One. Agenda description'
      },
      {
        sourceType: 'AGENDA_ITEM',
        sourceID: '102',
        title: 'Agenda Two',
        description: '',
        externalID: '',
        textOriginal: 'Agenda Two'
      },
      {
        sourceType: 'TIMELINE_ITEM',
        sourceID: '301',
        title: 'Timeline One',
        description: '',
        externalID: '',
        textOriginal: 'Timeline One'
      },
      {
        sourceType: 'TIMELINE_ITEM',
        sourceID: '302',
        title: 'Imported Timeline',
        description: '',
        externalID: 'VOTING_ACTIVITY_IMPORT::1',
        textOriginal: 'Imported Timeline'
      }
    ]);
  });

  it('extractRawHintTextsFromFullEvent collects event/agenda/timeline texts and dedupes', () => {
    const result = extractRawHintTextsFromFullEvent({
      title: 'Event Alpha',
      description: 'Opening Session',
      timeline: [
        { externalID: '', title: 'Timeline One' },
        { externalID: 'VOTING_ACTIVITY_IMPORT::1', title: 'Ignored Timeline' },
        { externalID: '', title: '  ' }
      ],
      agenda: [
        { title: 'Agenda One' },
        { title: 'Timeline One' }
      ]
    });

    expect(result).to.deep.equal(['Event Alpha. Opening Session', 'Agenda One', 'Timeline One', 'Ignored Timeline']);
  });

  it('extractRawHintTextsFromFullEvent prioritizes event then agenda then timeline ordering', () => {
    const result = extractRawHintTextsFromFullEvent({
      title: 'Event First',
      description: '',
      agenda: [
        { title: 'Agenda First 1' },
        { title: 'Agenda First 2' }
      ],
      timeline: [
        { externalID: '', title: 'Timeline Later 1' },
        { externalID: '', title: 'Timeline Later 2' }
      ]
    });

    expect(result.slice(0, 5)).to.deep.equal([
      'Event First',
      'Agenda First 1',
      'Agenda First 2',
      'Timeline Later 1',
      'Timeline Later 2'
    ]);
  });

  it('uses anthropic path when explicitly configured', async () => {
    let calledUrl = '';
    const result = await extractProperNounsFromTextsWithMeta(
      ['Resolution 25-267', 'OHM Advisors'],
      {
        config: {
          hintExtraction: { provider: 'anthropic', timeoutMS: 1000 },
          anthropic: { apiKey: 'sk-ant-test' },
          openai: { apiKey: '' }
        },
        fetch: async (url) => {
          calledUrl = url;
          return {
            ok: true,
            json: async () => ({
              content: [{ text: '["Resolution 25-267","OHM Advisors"]' }]
            })
          };
        }
      }
    );

    expect(calledUrl).to.equal('https://api.anthropic.com/v1/messages');
    expect(result.keyTerms).to.deep.equal(['Resolution 25-267', 'OHM Advisors']);
    expect(result.eventWarnings).to.deep.equal([]);
  });

  it('auto-detects openai when only openai key is present', async () => {
    let calledUrl = '';
    const result = await extractProperNounsFromTextsWithMeta(
      ['Copper Ridge Phase 6'],
      {
        config: {
          hintExtraction: {},
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async (url) => {
          calledUrl = url;
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: '["Copper Ridge Phase 6"]' } }]
            })
          };
        }
      }
    );

    expect(calledUrl).to.equal('https://api.openai.com/v1/chat/completions');
    expect(result.keyTerms).to.deep.equal(['Copper Ridge Phase 6']);
    expect(result.eventWarnings).to.deep.equal([]);
    expect(result.aiDebug.isLLMUsed).to.equal(true);
    expect(result.aiDebug.provider).to.equal('openai');
    expect(result.aiDebug.llmInputTexts).to.deep.equal(['Copper Ridge Phase 6']);
    expect(result.aiDebug.llmUserPrompt).to.be.a('string');
  });

  it('cleans LLM key terms using heuristic signals (drops noisy single words)', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Call to Order', 'Carter Napier', 'BOMA update'],
      {
        config: {
          hintExtraction: { provider: 'openai', timeoutMS: 1000 },
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '["Call","Order","Carter Napier","BOMA","Carter"]' } }]
          })
        })
      }
    );

    expect(result.keyTerms).to.include('Carter Napier');
    expect(result.keyTerms).to.include('BOMA');
    expect(result.keyTerms).to.not.include('Call');
    expect(result.keyTerms).to.not.include('Order');
    expect(result.keyTerms).to.not.include('Carter');
  });

  it('accepts fenced json from llm response', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Copper Ridge', 'Summer Meadows'],
      {
        config: {
          hintExtraction: { provider: 'openai', timeoutMS: 1000 },
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: '```json\n["Copper Ridge","Summer Meadows"]\n```'
              }
            }]
          })
        })
      }
    );

    expect(result.aiDebug.isLLMUsed).to.equal(true);
    expect(result.keyTerms).to.include('Copper Ridge');
    expect(result.keyTerms).to.include('Summer Meadows');
  });

  it('accepts empty json array from llm response', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Call to Order'],
      {
        config: {
          hintExtraction: { provider: 'openai', timeoutMS: 1000 },
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '[]' } }]
          })
        })
      }
    );

    expect(result.aiDebug.isLLMUsed).to.equal(true);
    expect(result.eventWarnings).to.deep.equal([]);
    expect(result.keyTerms).to.deep.equal([]);
  });

  it('dedupes project variants to canonical names and drops code-like tokens', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Copper Ridge', 'Summer Meadows'],
      {
        config: {
          hintExtraction: { provider: 'openai', timeoutMS: 1000 },
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify([
                  'Copper Ridge',
                  '1a Copper Ridge Phase',
                  '2b Copper Ridge Phase',
                  '2c Copper Ridge Ph8 Final',
                  'Completion Copper Ridge Phase 8',
                  'Summer Meadows',
                  '3a Summer Meadows Phase',
                  '3d Summer Meadows Phase',
                  '3c Cert',
                  '2a',
                  '2b',
                  '3c'
                ])
              }
            }]
          })
        })
      }
    );

    expect(result.keyTerms).to.include('Copper Ridge');
    expect(result.keyTerms).to.include('Summer Meadows');
    expect(result.keyTerms).to.not.include('1a Copper Ridge Phase');
    expect(result.keyTerms).to.not.include('2b Copper Ridge Phase');
    expect(result.keyTerms).to.not.include('2c Copper Ridge Ph8 Final');
    expect(result.keyTerms).to.not.include('Completion Copper Ridge Phase 8');
    expect(result.keyTerms).to.not.include('3a Summer Meadows Phase');
    expect(result.keyTerms).to.not.include('3d Summer Meadows Phase');
    expect(result.keyTerms).to.not.include('3c Cert');
    expect(result.keyTerms).to.not.include('2a');
    expect(result.keyTerms).to.not.include('2b');
    expect(result.keyTerms).to.not.include('3c');
  });

  it('falls back to heuristic with warning when configured provider key is missing', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Resolution 25-267 City Board'],
      {
        config: {
          hintExtraction: { provider: 'openai' },
          anthropic: { apiKey: '' },
          openai: { apiKey: '' }
        }
      }
    );

    expect(result.eventWarnings).to.deep.equal(['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED']);
    expect(result.keyTerms).to.include('Resolution 25-267');
    expect(result.keyTerms).to.not.include('City');
    expect(result.keyTerms).to.not.include('Board');
  });

  it('falls back to heuristic with warning on llm HTTP failure', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Water and Sewer Division'],
      {
        config: {
          hintExtraction: { provider: 'anthropic', timeoutMS: 1000 },
          anthropic: { apiKey: 'sk-ant-test' },
          openai: { apiKey: '' }
        },
        fetch: async () => ({ ok: false, status: 500, text: async () => 'upstream exploded', json: async () => ({}) })
      }
    );

    expect(result.eventWarnings).to.deep.equal(['EVENT_HINTS_PROPER_NOUN_EXTRACTION_FAILED']);
    expect(result.keyTerms).to.include('Sewer Division');
    expect(result.keyTerms).to.not.include('Water');
    expect(result.aiDebug.failureReason).to.equal('llm-call-failed');
    expect(result.aiDebug.failureCode).to.equal('llm-http-error');
    expect(result.aiDebug.failureMessage).to.match(/status 500/i);
    expect(result.aiDebug.failureDetails.httpStatus).to.equal(500);
  });

  it('heuristic fallback favors phrase-level terms over generic single words', async () => {
    const result = await extractProperNounsFromTextsWithMeta(
      ['Call Regular Order', 'Resolution 25-267', 'OHM Advisors', 'Carter Napier'],
      {
        config: {
          hintExtraction: { provider: 'heuristic' },
          anthropic: { apiKey: '' },
          openai: { apiKey: '' }
        }
      }
    );

    expect(result.keyTerms).to.include('OHM Advisors');
    expect(result.keyTerms).to.include('Carter Napier');
    expect(result.keyTerms).to.not.include('Call');
    expect(result.keyTerms).to.not.include('Regular');
    expect(result.keyTerms).to.not.include('Order');
  });

  it('caps output at 150 terms', async () => {
    const llmTerms = Array.from({ length: 180 }, (_, index) => `Project Name${index}`);
    const result = await extractProperNounsFromTextsWithMeta(
      ['Large dataset'],
      {
        config: {
          hintExtraction: { provider: 'openai', timeoutMS: 1000 },
          anthropic: { apiKey: '' },
          openai: { apiKey: 'sk-openai-test' }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(llmTerms) } }]
          })
        })
      }
    );

    expect(result.keyTerms.length).to.equal(150);
    expect(result.eventWarnings).to.deep.equal([]);
  });

  it('buildEventKeyTerms returns event-not-found warning when CustomerAPI has no event', async () => {
    const result = await buildEventKeyTerms(69, 1175, {
      customerApiClient: {
        requestGet: async () => null
      },
      config: {
        hintExtraction: { provider: 'heuristic' },
        anthropic: { apiKey: '' },
        openai: { apiKey: '' }
      }
    });

    expect(result).to.deep.equal({
      customerMediaID: null,
      mediaPath: null,
      keyTerms: [],
      keywordListJSON: [],
      eventAndItemsRows: [],
      eventWarnings: ['EVENT_HINTS_EVENT_NOT_FOUND'],
      aiHintDebug: {
        isLLMUsed: false,
        provider: 'none',
        llmInputTexts: [],
        llmInputCharCount: 0,
        llmUserPrompt: ''
      }
    });
  });

  it('buildEventMediaContext resolves primary media without key-term extraction', async () => {
    const result = await buildEventMediaContext(69, 1175, {
      customerApiClient: {
        requestGet: async () => ({
          media: [
            {
              mediaClassID: 4,
              mediaTypeID: 1,
              deletedDateTimeUTC: null,
              customerMediaID: 42,
              mediaFileLocation: '2026-02',
              mediaFileName: 'abc.mp4'
            }
          ]
        })
      }
    });

    expect(result).to.deep.equal({
      customerMediaID: 42,
      mediaPath: '2026-02/abc.mp4',
      eventWarnings: []
    });
  });

  it('buildEventMediaContext returns primary-media warning when media is missing', async () => {
    const result = await buildEventMediaContext(69, 1175, {
      customerApiClient: {
        requestGet: async () => ({ media: [] })
      }
    });

    expect(result).to.deep.equal({
      customerMediaID: null,
      mediaPath: null,
      eventWarnings: ['EVENT_HINTS_PRIMARY_MEDIA_NOT_FOUND']
    });
  });
});

Transcripts and TranscriptUtterances are too narrow for the type of data we're going to be storing.  

- Transcripts and Utterances are Speech-to-Text Extractions from the Media
- They can also be Text-to-Speech cues
- They can also be silence detection

A thought occurs:  
- They could also be topic extraction from Agenda Item(s) 
- Also keyword(s) extraction from all the text present in an event (Agenda Items, Minute Items, Timeline Items, the Event Title / Description)
- Also text extraction from a PDF for searching (eg, what was found and what page was it on)
- Also "graphics detected" from an mp4 (eg, just what was found)

I believe we want to call this "extractions" and "extractionItems".  For the purposes of migrating from "transcripts" and "transcriptUtterances" they should map 1:1 here.  
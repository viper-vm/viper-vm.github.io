"""
WordGen Python Backend (FastAPI)
Optional server for WordGen - not required for GitHub Pages deployment
Deploy separately if needed
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn

app = FastAPI(title="WordGen API", version="1.0.0")

# CORS middleware for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response Models
class SynonymRequest(BaseModel):
    action: str
    word: str
    pos: str
    context: str
    settings: Dict[str, Any] = {}

class RephraseRequest(BaseModel):
    action: str
    sentence: str
    preset: str
    settings: Dict[str, Any] = {}

class Candidate(BaseModel):
    word: str
    register: str = "neutral"
    commonness: str = "common"
    note: str = ""

class Rewrite(BaseModel):
    text: str
    note: str = ""

class SynonymResponse(BaseModel):
    candidates: List[Candidate]

class RephraseResponse(BaseModel):
    rewrites: List[Rewrite]

# In-memory lexicon (simplified - replace with actual WordNet/dictionary)
LEXICON = {
    "good": ["excellent", "fine", "great", "nice", "pleasant"],
    "bad": ["poor", "terrible", "awful", "unpleasant"],
    "big": ["large", "huge", "enormous", "vast"],
    "small": ["little", "tiny", "minute", "compact"],
    "happy": ["joyful", "cheerful", "content", "pleased"],
    "sad": ["unhappy", "sorrowful", "melancholy"],
}

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "WordGen API",
        "status": "running",
        "version": "1.0.0"
    }

@app.post("/synonyms", response_model=SynonymResponse)
async def get_synonyms(request: SynonymRequest):
    """
    Get synonym candidates for a word

    In production, this would:
    1. Use WordNet/dictionary for lexical synonyms
    2. Use word embeddings for semantic similarity
    3. Optionally call an LLM for context-aware suggestions
    4. Rank and filter results
    """
    word = request.word.lower()

    # Simple lexical lookup (demo)
    candidates = []
    if word in LEXICON:
        for synonym in LEXICON[word][:8]:
            candidates.append(Candidate(
                word=synonym,
                register="neutral",
                commonness="common",
                note=f"Synonym for {word}"
            ))

    if not candidates:
        # Fallback: return word itself
        candidates.append(Candidate(
            word=word,
            register="neutral",
            commonness="common",
            note="No synonyms found"
        ))

    return SynonymResponse(candidates=candidates)

@app.post("/rephrase", response_model=RephraseResponse)
async def rephrase_sentence(request: RephraseRequest):
    """
    Generate rephrase options for a sentence

    In production, this would:
    1. Use rule-based transformations
    2. Call an LLM with specific prompts for each preset
    3. Validate meaning preservation
    """
    sentence = request.sentence
    preset = request.preset

    # Simple rule-based rephrasing (demo)
    rewrites = []

    if preset == "shorter":
        # Remove filler words
        shorter = sentence.replace(" very ", " ").replace(" really ", " ").strip()
        rewrites.append(Rewrite(
            text=shorter,
            note="Removed filler words"
        ))

    elif preset == "formal":
        # Expand contractions
        formal = (sentence
                  .replace("don't", "do not")
                  .replace("can't", "cannot")
                  .replace("won't", "will not"))
        rewrites.append(Rewrite(
            text=formal,
            note="Expanded contractions"
        ))

    elif preset == "casual":
        # Use contractions
        casual = (sentence
                  .replace("do not", "don't")
                  .replace("cannot", "can't")
                  .replace("will not", "won't"))
        rewrites.append(Rewrite(
            text=casual,
            note="Used contractions"
        ))

    else:  # clearer
        rewrites.append(Rewrite(
            text=sentence,
            note="Consider breaking complex clauses"
        ))

    # Always return at least the original
    if not rewrites or all(r.text == sentence for r in rewrites):
        rewrites = [Rewrite(
            text=sentence,
            note=f"Configure an LLM for better {preset} rephrasing"
        )]

    return RephraseResponse(rewrites=rewrites)

@app.get("/health")
async def health_check():
    """Health check for monitoring"""
    return {"status": "healthy"}

if __name__ == "__main__":
    # Run with: python main.py
    # Or: uvicorn main:app --reload
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )

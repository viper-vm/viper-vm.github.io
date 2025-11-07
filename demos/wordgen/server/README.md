# WordGen Python Backend (Optional)

This is an optional FastAPI backend for WordGen. It is **not required** for the GitHub Pages deployment, which works entirely client-side.

## Purpose

Use this backend if you want to:
- Deploy WordGen with server-side processing
- Implement more sophisticated NLP algorithms
- Use larger datasets that can't be shipped to the browser
- Add authentication/rate limiting
- Cache results for better performance

## Setup

### Local Development

1. **Install dependencies**:
```bash
cd server
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. **Run the server**:
```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

3. **Test the API**:
```bash
curl http://localhost:8000/
```

4. **View API docs**:
Open `http://localhost:8000/docs` in your browser

### Configure WordGen to Use Local Backend

1. Open WordGen in your browser
2. Click **Settings**
3. Select **Custom HTTP** provider
4. Enter:
   - **Endpoint URL**: `http://localhost:8000`
   - **Headers**: `{}` (or add custom headers if needed)
5. Click **Save Settings**

## API Endpoints

### GET /
Health check and service info

**Response**:
```json
{
  "service": "WordGen API",
  "status": "running",
  "version": "1.0.0"
}
```

### POST /synonyms
Get synonym candidates for a word

**Request**:
```json
{
  "action": "synonyms",
  "word": "example",
  "pos": "noun",
  "context": "This is an example sentence.",
  "settings": {
    "domain": "general",
    "maxChars": 500
  }
}
```

**Response**:
```json
{
  "candidates": [
    {
      "word": "sample",
      "register": "neutral",
      "commonness": "common",
      "note": "Synonym for example"
    }
  ]
}
```

### POST /rephrase
Generate rephrase options

**Request**:
```json
{
  "action": "rephrase",
  "sentence": "This is an example sentence.",
  "preset": "shorter",
  "settings": {
    "domain": "general"
  }
}
```

**Response**:
```json
{
  "rewrites": [
    {
      "text": "This is a sample sentence.",
      "note": "Removed filler words"
    }
  ]
}
```

### GET /health
Health check for monitoring

**Response**:
```json
{
  "status": "healthy"
}
```

## Deployment

### Deploy to Railway / Render / Fly.io

1. **Create a `Procfile`** (for platforms that use it):
```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

2. **Push to your deployment platform**

3. **Update WordGen settings** with your deployed URL

### Deploy to AWS Lambda (with Mangum)

1. **Add Mangum** to requirements.txt:
```
mangum==0.17.0
```

2. **Wrap the app**:
```python
from mangum import Mangum
handler = Mangum(app)
```

3. **Deploy** using AWS SAM or Serverless Framework

### Deploy to Docker

1. **Create a `Dockerfile`**:
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

2. **Build and run**:
```bash
docker build -t wordgen-api .
docker run -p 8000:8000 wordgen-api
```

## Extending the Backend

### Add WordNet Integration

```python
from nltk.corpus import wordnet

def get_wordnet_synonyms(word, pos):
    synsets = wordnet.synsets(word, pos=pos)
    synonyms = set()
    for synset in synsets:
        for lemma in synset.lemmas():
            synonyms.add(lemma.name().replace('_', ' '))
    return list(synonyms)
```

### Add Embedding-Based Similarity

```python
import gensim.downloader as api

# Load word vectors
model = api.load("word2vec-google-news-300")

def get_similar_words(word, topn=10):
    try:
        similar = model.most_similar(word, topn=topn)
        return [w for w, score in similar]
    except KeyError:
        return []
```

### Add LLM Integration

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key="your-key")

async def get_llm_synonyms(word, context):
    response = await client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{
            "role": "user",
            "content": f"Provide 5 synonyms for '{word}' in context: {context}"
        }]
    )
    return response.choices[0].message.content
```

## Security Considerations

- **CORS**: Restrict `allow_origins` in production
- **Rate Limiting**: Add rate limiting middleware
- **Authentication**: Implement API key authentication if needed
- **Input Validation**: Already handled by Pydantic models
- **HTTPS**: Always use HTTPS in production

## Monitoring

Add logging and metrics:

```python
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"{request.method} {request.url.path}")
    response = await call_next(request)
    return response
```

## License

Same as WordGen main project

---

For questions or issues, contact vivekvm8400@gmail.com

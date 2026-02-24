

---

## Track A — Data / Docs (Owner 1)

**Goal:** Build a demo corpus + metadata that makes retrieval look “real”.

### TODOs

* [ ] **Pick demo scope + jurisdictions** (e.g., Federal + Manitoba, or Federal + Ontario)

  * **Deliverable:** 1-page list of included jurisdictions + 5–10 example questions.
* [ ] **Collect 30–80 public docs/pages** (mix of: acts/regulations, guidance, permit steps, forms pages)

  * **Deliverable:** `data/raw/` populated + a CSV/JSON manifest.
* [ ] **Create a doc manifest with metadata**

  * Fields: `doc_id`, `title`, `source_url`, `jurisdiction`, `doc_type`, `topic_tags`
  * **Deliverable:** `data/manifest.json` (or `.csv`)
* [ ] **Quick sanity QA**

  * Remove duplicate pages, broken PDFs, non-text scans
  * **Deliverable:** A clean curated corpus ready for parsing

### Acceptance Criteria

* ≥30 docs with valid URLs and metadata
* Each doc fits at least one demo question

---

## Track B — Qdrant Setup (Owner 2)

**Goal:** Local Qdrant running + a working collection.

### TODOs

* [ ] **Docker compose for Qdrant**

  * Expose `6333`, add persistent volume
  * **Deliverable:** `qdrant/docker-compose.yml`
* [ ] **Collection creation script**

  * Name: `reg_docs`
  * Vector size: matches embedding model
  * Distance: cosine
  * **Deliverable:** `ingest/create_collection.py`
* [ ] **Basic smoke test**

  * Upsert 3 dummy vectors + query nearest neighbors
  * **Deliverable:** `ingest/qdrant_smoke_test.py`

### Acceptance Criteria

* `docker compose up` works
* Collection exists and query returns results

---

## Track C — Ingestion + Indexing (LlamaIndex) (Owner 3)

**Goal:** Parse → chunk → embed → store in Qdrant.

### TODOs

* [ ] **Parsers**

  * HTML pages → clean text (strip nav/footer)
  * PDFs → extract text
  * **Deliverable:** `ingest/loaders.py`
* [ ] **Chunking**

  * Chunk by headings when possible; otherwise token-based with overlap
  * **Deliverable:** `ingest/chunking.py`
* [ ] **Embedding integration**

  * OpenAI embeddings (or chosen model)
  * **Deliverable:** `ingest/embeddings.py` + `.env` template
* [ ] **Upsert pipeline**

  * Iterate docs → chunks → embed → upsert with payload metadata
  * **Deliverable:** `ingest/run_ingest.py`
* [ ] **Ingestion report**

  * Print: #docs, #chunks, avg chunk length, top metadata counts
  * **Deliverable:** console report + optional `data/ingest_stats.json`

### Acceptance Criteria

* Running `python ingest/run_ingest.py` populates Qdrant with ≥500 chunks
* Each chunk has payload keys: `title`, `source_url`, `jurisdiction`, `doc_type`

---

## Track D — “Orange Zebra” RAG Orchestrator (Owner 4)

**Goal:** One function call that returns answer + citations.

### TODOs

* [ ] **Retriever**

  * Query Qdrant top_k=8–12
  * Optional payload filter: jurisdiction, doc_type
  * **Deliverable:** `app/retriever.py`
* [ ] **Context pack builder**

  * Format retrieved chunks into numbered citations `[1]...[k]`
  * **Deliverable:** `app/context.py`
* [ ] **Prompt templates**

  * System + user templates enforcing: grounded answer, checklist, step-by-step, and “Sources”
  * **Deliverable:** `app/prompts.py`
* [ ] **LLM call**

  * OpenAI SDK call with context injected
  * **Deliverable:** `app/llm.py`
* [ ] **Main orchestration**

  * `answer(question, filters) -> {answer, sources[]}`
  * **Deliverable:** `app/rag.py`
* [ ] **Quality rules**

  * If retrieval confidence is low/empty: return “Not in corpus” + suggest what to add
  * **Deliverable:** implemented fallback logic + unit test

### Acceptance Criteria

* Given a query, returns:

  * `answer` containing citations like `[1] [2]`
  * `sources[]` with title/url/section
* Handles “no results” gracefully

---

## Track E — Flask API (Owner 5)

**Goal:** Stable backend endpoint for frontend.

### TODOs

* [ ] **Flask server skeleton**

  * `/health`
  * `/chat`
  * **Deliverable:** `app/server.py`
* [ ] **Request/response schema**

  * Request: `{message, jurisdiction?, doc_type?}`
  * Response: `{answer, sources[]}`
  * **Deliverable:** JSON schema in README + validation
* [ ] **CORS + error handling**

  * Friendly errors for missing env vars / Qdrant down
  * **Deliverable:** robust error responses
* [ ] **Integration test**

  * Script that calls `/chat` and prints the output
  * **Deliverable:** `tests/api_smoke_test.py`

### Acceptance Criteria

* Frontend can hit `/chat` and get consistent JSON
* Server runs with one command

---

## Track F — Frontend Demo UI (Owner 6)

**Goal:** Chat UI that showcases citations + links.

### TODOs

* [ ] **Chat UI**

  * message input + send
  * loading state
  * **Deliverable:** simple web UI
* [ ] **Sources panel**

  * Render numbered sources with clickable URLs
  * **Deliverable:** sources list under each bot response
* [ ] **Filters**

  * Dropdown: jurisdiction (federal / province)
  * **Deliverable:** filter values sent to backend
* [ ] **Demo scripts**

  * 8–12 “wow” questions to paste quickly
  * **Deliverable:** “demo questions” panel / copy buttons (optional)

### Acceptance Criteria

* Clean UI, citations visible, links work
* Filter visibly changes results (at least in sources)

---

## Cross-team TODOs (Everyone / Lead)

* [ ] **Define embedding model + vector size once**

  * Document it in README
* [ ] **Environment setup**

  * `.env.example` with required keys (OpenAI, Qdrant URL)
* [ ] **Runbook**

  * “How to start” steps: Qdrant → ingest → API → UI
* [ ] **Demo narrative**

  * 2–3 minute pitch + 1 minute technical walkthrough

---

## Suggested split for a 4-person team (if you need it)

* Person 1: Track A + demo script
* Person 2: Track B + Track C
* Person 3: Track D
* Person 4: Track E + Track F (or F alone if UI-heavy)

# ComplAInce - Regulatory Compliance Chatbot

Turning complex regulatory red tapes to simple conversations.

**ComplAInce** is a solution developed during Southern Manitoba Technology Conference's 6-hour Hackathon for Challenge 3: Regulatory Compliance Chatbot.

## Problem Statement

Do you ever read the Terms and Services of the applications you use? Reading through pages and pages of rules and regulations is considerably lame compared to getting your software up and running.

However, that is not a luxury businesses can afford. According to CFIB's [Canada's Red Tape Report](https://www.cfib-fcei.ca/en/research-economic-analysis/canadas-red-tape-report) in 2024, businesses of all sizes spent **768 million dollars** on regulatory compliance alone. That is the equivalent of nearly **394,000 full-time jobs**, just being spent scouring through provincial and federal regulations: invaluable human costs that should instead be spent on innovation, on growth, on creating value for your employees, your customers, and the entire industry.

Regulations are heavily text-based, highly specific, and constantly updated across disparate government websites, like the Continuing Consolidation of the Statutes of Manitoba, or C.C.S.M. Furthermore, regulations are never static; new laws and penalties are being introduced some unknown time in the future from now via the Accessibility for Manitobans Act. Manufacturers seek a solution with the ability to stay updated with and summarize all this abundant information, yet current solutions like ChatGPT are still prone to hallucinations and being unable to cite their sources; that which is most unacceptable when dealing with law enforcement.

Seeing this, we built **ComplAInce** - a chatbot that actually knows what it's talking about, to accompany your manufacturing team in turning complex regulatory red tapes to simple conversations.

## Tech Stack

- **Frontend**: React + Tailwind
- **Backend**: Flask
- **LLM Provider**: OpenAI
- **Vector Database**: Qdrant
- **OCR**: LlamaIndex

## Architecture

1. The user uploads the documents that the chatbot will source from. Else, the chatbot is equipped with pre-downloaded regulatory documents relevant to the Manitoban industry, which can be viewed, updated, or deleted from its knowledge base.
1. Text is extracted from the regulatory documents, broken up into chunks, and embedded into the vector database. Each chunk of text has metadata linking back to which document it came from.
1. When the user send a query, the query is embedded and compared against the vector database. Queries can be a simple question, a request to be guided through the application process for some permit, or the user can also upload a document such as their business plan and ask if it's compliant with all the regulations.
1. A RAG pipeline will be run, and the most relevant information chunks from the documents will be matched with the query. Information chunks must be above some certain "relevancy" thresholds.
1. The LLM will answer the user's inquiry, citing text chunks and explicitly linking which documents they got the information from. The LLM will also scores itself based on a function of the total relevancy of the information chunks it used in its response; if the score is below a certain threshold, it will not give an answer to the user's inquiry.
1. Users can create new chat sessions, revisit old ones, and delete old sessions.
1. (Not implemented) Authentication.
1. (Not implemented) To make sure the regulatory documents are up to date, a daily scraper connected to official provincial/federal regulators will detect if new documents are being put out, and whether they'd replace any old ones. If there is, the next time the user logs in, an alert will be created on whether they'd like to update the knowledge base with this new information; the documents are then inserted into or deleted from the vector database.

## Team Members

- Alexandr Yermakov
- Ethan Henry
- Maksym Lan
- McCauley Armishaw
- Peter Vu

## Original Problem Description

**Problem**: Navigating complex provincial/federal regulations is time-consuming and confusing

**Hackathon Challenge**: Build an AI Assistant that:
* Answers common regulatory questions for manufacturers
* Guides users through permit application processes step-by-step
* Identifies which regulations apply to specific operations
* Provides checklists for compliance requirements
* Links to relevant government resources and forms

**Tech Stack**: LLM integration (Claude API, OpenAI), RAG with regulatory documents


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

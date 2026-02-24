"""
RAG-based compliance chatbot backend using FastAPI, OpenAI, Qdrant, and LlamaIndex.
"""

import os
from contextlib import asynccontextmanager
from io import BytesIO

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from openai import OpenAI
from pypdf import PdfReader

# Load environment variables BEFORE importing config/RAGSystem so .env values (like QDRANT_URL) are applied.
load_dotenv()

from llama_index.core import (
    Document,
)

try:
    from backend.RAGSystem import RAGSystem
    from backend.config import config
    from backend.models import HealthResponse, QueryRequest, QueryResponse, UploadResponse
except ModuleNotFoundError:
    from RAGSystem import RAGSystem
    from config import config
    from models import HealthResponse, QueryRequest, QueryResponse, UploadResponse

rag_system = RAGSystem()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    rag_system.initialize()
    yield
    # Shutdown: cleanup if needed


app = FastAPI(
    title="Reg Compliance Chatbot API",
    description="RAG-based API for regulatory compliance queries",
    version="0.1.0",
    lifespan=lifespan,
)


# =============================================================================
# Admin HTML Page
# =============================================================================


UPLOAD_TEST_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>RAG Upload Test</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 800px; }
    h1, h2 { margin-bottom: 0.5rem; }
    form, section { margin-bottom: 2rem; }
    input, button, textarea { font: inherit; }
    button { padding: 0.4rem 0.8rem; cursor: pointer; }
    #upload-status, #query-result { white-space: pre-wrap; margin-top: 0.5rem; }
    label { display: block; margin-bottom: 0.25rem; }
  </style>
</head>
<body>
  <h1>RAG Upload Test</h1>

  <section>
    <h2>Upload & Vectorize Document</h2>
    <form id="upload-form">
      <label for="file">Choose a text file to index:</label>
      <input type="file" id="file" name="file" accept=".txt,.md,.html,.pdf" required />
      <br /><br />
      <button type="submit">Upload & Index</button>
    </form>
    <div id="upload-status"></div>
  </section>

  <section>
    <h2>Query Indexed Data</h2>
    <form id="query-form">
      <label for="query">Ask a question about the indexed documents:</label>
      <textarea id="query" name="query" rows="3" style="width:100%;" required></textarea>
      <br /><br />
      <label for="top_k">Top K (results to retrieve):</label>
      <input type="number" id="top_k" name="top_k" value="5" min="1" max="20" />
      <br /><br />
      <button type="submit">Run Query</button>
    </form>
    <div id="query-result"></div>
  </section>

  <script>
    const uploadForm = document.getElementById("upload-form");
    const uploadStatus = document.getElementById("upload-status");
    const queryForm = document.getElementById("query-form");
    const queryResult = document.getElementById("query-result");

    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById("file");
      if (!fileInput.files.length) {
        uploadStatus.textContent = "Please select a file first.";
        return;
      }
      const formData = new FormData();
      formData.append("file", fileInput.files[0]);

      uploadStatus.textContent = "Uploading and indexing...";
      try {
        const res = await fetch("/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || "Upload failed");
        }
        uploadStatus.textContent =
          `Success: indexed ${data.documents_count} document(s) into collection "${data.collection}".`;
      } catch (err) {
        uploadStatus.textContent = "Error: " + (err.message || String(err));
      }
    });

    queryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = document.getElementById("query").value.trim();
      const topK = parseInt(document.getElementById("top_k").value || "5", 10);
      if (!query) {
        queryResult.textContent = "Please enter a query.";
        return;
      }
      queryResult.textContent = "Running query...";
      try {
        const res = await fetch("/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, top_k: topK }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || "Query failed");
        }
        queryResult.textContent =
          "Answer:\\n" + data.answer + "\\n\\n" +
          "Sources: " + (data.sources && data.sources.length
            ? data.sources.join(", ")
            : "(none)") + "\\n" +
          "Nodes retrieved: " + data.nodes_retrieved;
      } catch (err) {
        queryResult.textContent = "Error: " + (err.message || String(err));
      }
    });
  </script>
</body>
</html>
"""


# =============================================================================
# Request/Response Models
# =============================================================================


class QueryRequest(BaseModel):
    """Request model for /query endpoint."""

    query: str
    top_k: int = 5


class WebSearchResult(BaseModel):
    """Model for web search result."""

    title: str
    url: str


class QueryResponse(BaseModel):
    """Response model for /query endpoint."""

    answer: str
    sources: list[str]
    nodes_retrieved: int
    relevant_documents: list[WebSearchResult]


class UploadResponse(BaseModel):
    """Response model for /upload endpoint."""

    status: str
    documents_count: int
    collection: str


class HealthResponse(BaseModel):
    """Response model for /health endpoint."""

    status: str
    initialized: bool
    collection: str


# =============================================================================
# Endpoints
# =============================================================================


@app.get("/", tags=["Health"])
async def root():
    """Root endpoint."""
    return {"message": "Reg Compliance Chatbot API"}


@app.get("/upload-test", response_class=HTMLResponse, tags=["Admin"])
async def upload_test():
    """Simple admin page for testing upload and query."""
    return UPLOAD_TEST_HTML


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Check API health status."""
    return HealthResponse(
        status="healthy",
        initialized=rag_system._initialized,
        collection=config.collection_name,
    )


@app.post("/upload", response_model=UploadResponse, tags=["RAG"])
async def upload_documents(
    file: UploadFile = File(...),
) -> UploadResponse:
    """
    Upload a document for RAG indexing.

    Flow: user uploads data → endpoint → LlamaIndex → vectorize → Qdrant

    - For PDFs: extract text using pypdf
    - For text-like files: decode as UTF-8
    """
    try:
        # Read file content as raw bytes
        content = await file.read()

        filename_lower = (file.filename or "").lower()
        content_type = (file.content_type or "").lower()

        # Handle PDF files via text extraction
        if filename_lower.endswith(".pdf") or "pdf" in content_type:
            try:
                reader = PdfReader(BytesIO(content))
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read PDF: {str(e)}",
                )

            text_chunks: list[str] = []
            for page in reader.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    text_chunks.append(page_text)

            text_content = "\n\n".join(text_chunks)
        else:
            # Non-PDF: treat as UTF-8 text, ignoring any bad bytes
            try:
                text_content = content.decode("utf-8", errors="ignore")
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail="Failed to decode file as UTF-8 text.",
                )

        if not text_content.strip():
            raise HTTPException(
                status_code=400,
                detail="Uploaded file contains no extractable text.",
            )

        # Chunk large documents so we don't exceed embedding context limits.
        # Use a character-based chunk size with margin below the 8k-token cap.
        max_chars = 20000

        base_metadata = {
            "file_name": file.filename,
            "content_type": file.content_type,
        }

        documents: list[Document] = []
        for i in range(0, len(text_content), max_chars):
            chunk_text = text_content[i : i + max_chars]
            if not chunk_text.strip():
                continue

            documents.append(
                Document(
                    text=chunk_text,
                    metadata={
                        **base_metadata,
                        "chunk_index": i // max_chars,
                    },
                )
            )

        if not documents:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file produced empty chunks after processing.",
            )

        # Upload to RAG system (vectorizes and stores in Qdrant)
        result = rag_system.upload_documents(documents)

        return UploadResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to upload document: {str(e)}"
        )


@app.post("/query", response_model=QueryResponse, tags=["RAG"])
async def query_documents(request: QueryRequest) -> QueryResponse:
    """
    Query the RAG system.

    Flow: user query → endpoint → vectorize (OpenAI) → Qdrant search →
          retrieve nodes → LlamaIndex → LLM → response
          → web search for relevant documents → return

    - Vectorizes the query using OpenAI embeddings
    - Searches Qdrant for similar vectors
    - Retrieves relevant document chunks
    - Passes to LLM for generation
    - Searches web for official documents/forms
    - Returns the generated response with relevant document links
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        # Query RAG system (includes web search internally)
        result = rag_system.query(
            query_text=request.query,
            top_k=request.top_k,
        )

        return QueryResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query: {str(e)}")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )

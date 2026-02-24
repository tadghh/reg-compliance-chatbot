"""
RAG-based compliance chatbot backend using FastAPI, OpenAI, Qdrant, and LlamaIndex.
"""

import os
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient
from openai import OpenAI
from pypdf import PdfReader

# LlamaIndex imports
from llama_index.core import (
    VectorStoreIndex,
    StorageContext,
    Settings,
    Document,
)
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.llms.openai import OpenAI as LlamaOpenAI
from llama_index.embeddings.openai import OpenAIEmbedding

# Load environment variables
load_dotenv()


# =============================================================================
# Configuration
# =============================================================================


class Config:
    """Application configuration."""

    # OpenAI settings
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    embedding_dimensions: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))

    # Qdrant settings
    qdrant_url: str = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key: str = os.getenv("QDRANT_API_KEY", "")
    collection_name: str = os.getenv("QDRANT_COLLECTION", "reg_compliance")

    # LlamaIndex settings
    chunk_size: int = int(os.getenv("CHUNK_SIZE", "512"))
    chunk_overlap: int = int(os.getenv("CHUNK_OVERLAP", "50"))


config = Config()


# =============================================================================
# RAG System
# =============================================================================


class RAGSystem:
    """Manages the RAG system with Qdrant vector store and LlamaIndex."""

    def __init__(self):
        self.client: QdrantClient | None = None
        self.vector_store: QdrantVectorStore | None = None
        self.storage_context: StorageContext | None = None
        self.index: VectorStoreIndex | None = None
        self._openai_client: OpenAI | None = None

        # Initialize on first use
        self._initialized = False

    def initialize(self) -> None:
        """Initialize the Qdrant client and LlamaIndex settings."""
        if self._initialized:
            return

        # Initialize LlamaIndex settings
        Settings.llm = LlamaOpenAI(
            model=config.openai_model,
            temperature=0.1,
            api_key=config.openai_api_key or None,
        )
        Settings.embed_model = OpenAIEmbedding(
            model=config.embedding_model,
            dimensions=config.embedding_dimensions,
            api_key=config.openai_api_key or None,
        )
        Settings.chunk_size = config.chunk_size
        Settings.chunk_overlap = config.chunk_overlap

        # Initialize Qdrant client
        self.client = QdrantClient(
            url=config.qdrant_url,
            api_key=config.qdrant_api_key or None,
        )

        # Create Qdrant vector store
        self.vector_store = QdrantVectorStore(
            client=self.client,
            collection_name=config.collection_name,
        )

        # Create storage context
        self.storage_context = StorageContext.from_defaults(
            vector_store=self.vector_store
        )

        # Try to load existing index, or create new one
        try:
            self.index = VectorStoreIndex.from_vector_store(
                vector_store=self.vector_store
            )
        except Exception:
            # Collection doesn't exist yet, will create on first upload
            self.index = None

        # Initialize OpenAI client for web search
        self._openai_client = OpenAI(api_key=config.openai_api_key or None)

        self._initialized = True

    def ensure_initialized(self) -> None:
        """Ensure the system is initialized before use."""
        if not self._initialized:
            self.initialize()

    def upload_documents(self, documents: list[Document]) -> dict[str, Any]:
        """
        Upload documents to the RAG system.

        Flow: documents → LlamaIndex → vectorize → Qdrant
        """
        self.ensure_initialized()

        if self.index is None:
            # Create new index from documents
            self.index = VectorStoreIndex.from_documents(
                documents,
                storage_context=self.storage_context,
                show_progress=True,
            )
        else:
            # Insert into existing index
            self.index.insert_nodes(documents, show_progress=True)

        return {
            "status": "success",
            "documents_count": len(documents),
            "collection": config.collection_name,
        }

    def search_web_for_documents(self, query: str) -> list[dict[str, str]]:
        """
        Search the web for relevant official documents and forms.

        Uses OpenAI's web_search tool to find relevant URLs and titles.

        Args:
            query: The search query

        Returns:
            List of dicts with 'title' and 'url' keys
        """
        self.ensure_initialized()

        if not self._openai_client:
            return []

        try:
            # Use OpenAI Responses API with web_search tool
            response = self._openai_client.responses.create(
                model=config.openai_model,
                tools=[{"type": "web_search"}],
                input=f"Find official government documents, forms, and regulations related to: {query}",
            )

            # Extract URLs and titles from search results
            results = []
            for output in response.output:
                if output.type == "message":
                    for content in output.content:
                        if content.type == "web_search_tool":
                            results.append(
                                {
                                    "title": content.title or "Untitled",
                                    "url": content.url,
                                }
                            )

            return results

        except Exception:
            # Silently return empty list on search failure
            return []

    def query(self, query_text: str, top_k: int = 5) -> dict[str, Any]:
        """
        Query the RAG system.

        Flow: query → vectorize (OpenAI) → Qdrant search →
              retrieve nodes → LlamaIndex → LLM → response
              → then search web for relevant documents
        """
        self.ensure_initialized()

        if self.index is None:
            raise HTTPException(
                status_code=400,
                detail="No documents indexed yet. Upload documents first.",
            )

        # Create query engine
        query_engine = self.index.as_query_engine(
            similarity_top_k=top_k,
            response_mode="compact",
        )

        # Execute query: vectorizes query, searches Qdrant, generates response
        response = query_engine.query(query_text)

        # Extract sources
        sources = []
        if hasattr(response, "source_nodes") and response.source_nodes:
            for node in response.source_nodes:
                source = (
                    node.metadata.get("file_name", "unknown")
                    if node.metadata
                    else "unknown"
                )
                sources.append(source)

        # Search web for relevant documents/forms
        web_results = self.search_web_for_documents(query_text)

        return {
            "answer": str(response),
            "sources": sources,
            "nodes_retrieved": len(response.source_nodes)
            if hasattr(response, "source_nodes")
            else 0,
            "relevant_documents": web_results,
        }


# Global RAG system instance
rag_system = RAGSystem()


# =============================================================================
# FastAPI App
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup: Initialize RAG system
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


# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )

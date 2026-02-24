"""
RAG-based compliance chatbot backend using FastAPI, OpenAI, Qdrant, and LlamaIndex.
"""

import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient

# LlamaIndex imports
from llama_index.core import (
    VectorStoreIndex,
    StorageContext,
    Settings,
    Document,
)
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.llms.openai import OpenAI
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

        # Initialize on first use
        self._initialized = False

    def initialize(self) -> None:
        """Initialize the Qdrant client and LlamaIndex settings."""
        if self._initialized:
            return

        # Initialize LlamaIndex settings
        Settings.llm = OpenAI(
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
            self.index.insert_documents(documents, show_progress=True)

        return {
            "status": "success",
            "documents_count": len(documents),
            "collection": config.collection_name,
        }

    def query(self, query_text: str, top_k: int = 5) -> dict[str, Any]:
        """
        Query the RAG system.

        Flow: query → vectorize (OpenAI) → Qdrant search →
              retrieve nodes → LlamaIndex → LLM → response
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

        return {
            "answer": str(response),
            "sources": sources,
            "nodes_retrieved": len(response.source_nodes)
            if hasattr(response, "source_nodes")
            else 0,
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
# Request/Response Models
# =============================================================================


class QueryRequest(BaseModel):
    """Request model for /query endpoint."""

    query: str
    top_k: int = 5


class QueryResponse(BaseModel):
    """Response model for /query endpoint."""

    answer: str
    sources: list[str]
    nodes_retrieved: int


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

    - Reads the uploaded file
    - Creates a Document using LlamaIndex
    - Vectorizes using OpenAI embeddings
    - Stores in Qdrant vector database
    """
    try:
        # Read file content
        content = await file.read()
        text_content = content.decode("utf-8")

        if not text_content.strip():
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        # Create LlamaIndex Document
        document = Document(
            text=text_content,
            metadata={
                "file_name": file.filename,
                "content_type": file.content_type,
            },
        )

        # Upload to RAG system (vectorizes and stores in Qdrant)
        result = rag_system.upload_documents([document])

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

    - Vectorizes the query using OpenAI embeddings
    - Searches Qdrant for similar vectors
    - Retrieves relevant document chunks
    - Passes to LLM for generation
    - Returns the generated response
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        # Query RAG system
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

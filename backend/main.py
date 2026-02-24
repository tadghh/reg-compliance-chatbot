"""
RAG-based compliance chatbot backend using FastAPI, OpenAI, Qdrant, and LlamaIndex.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File

from llama_index.core import (
    Document,
)

from RAGSystem import RAGSystem
from config import config
from models import HealthResponse, QueryRequest, QueryResponse, UploadResponse

load_dotenv()

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

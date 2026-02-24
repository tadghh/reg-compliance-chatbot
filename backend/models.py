from pydantic import BaseModel

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

from typing import Any

from fastapi import HTTPException
from qdrant_client import QdrantClient
from openai import OpenAI

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

try:
    from backend.config import config
except ModuleNotFoundError:
    from config import config


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
                input=f"Find relevent government documents and forms related to: {query}",
            )

            # Extract URLs and titles from annotations (url_citation)
            results = []
            seen_urls = set()  # Deduplicate

            for output in response.output:
                if output.type == "message":
                    for content_block in output.content:
                        # Check for annotations containing url_citation
                        if hasattr(content_block, "annotations") and content_block.annotations:
                            for annotation in content_block.annotations:
                                if annotation.type == "url_citation":
                                    url = annotation.url
                                    if url and url not in seen_urls:
                                        seen_urls.add(url)
                                        results.append({
                                            "title": annotation.title or "Untitled",
                                            "url": url,
                                        })

            return results

        except Exception as e:
            # Log the error for debugging
            print(f"Web search failed: {type(e).__name__}: {e}")
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

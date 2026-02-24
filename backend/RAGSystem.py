from enum import Enum
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel
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

from config import config


class QueryType(str, Enum):
    """High-level intent for regulatory queries."""

    GENERAL_QA = "general_qa"
    PERMIT_GUIDANCE = "permit_guidance"
    REG_IDENTIFICATION = "reg_identification"
    CHECKLIST = "checklist"


class ClassifiedQuery(BaseModel):
    """Result of the first prompt in the chain."""

    query_type: QueryType
    rewritten_query: str


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
        # Temperature is forced to 0 to avoid speculative or irrelevant answers.
        Settings.llm = LlamaOpenAI(
            model=config.openai_model,
            temperature=0.0,
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

    def _classify_and_rewrite(self, user_query: str) -> ClassifiedQuery:
        """
        First prompt in the chain: classify intent and rewrite query for retrieval.
        """
        system_prompt = """
You are a regulatory compliance assistant for Canadian manufacturers.
Your task for THIS STEP ONLY:
1) Classify the user's request into one of:
   - general_qa: direct question about regulations
   - permit_guidance: wants step-by-step permit application help
   - reg_identification: wants to know which regulations apply
   - checklist: wants a practical compliance checklist
2) Rewrite the query into a clear, search-optimized form for retrieval.

Return STRICT JSON with keys:
- "query_type": one of ["general_qa","permit_guidance","reg_identification","checklist"]
- "rewritten_query": string

Do not include explanations or extra text.
"""
        prompt = f"{system_prompt}\n\nUSER QUERY:\n{user_query}\n\nJSON:"
        raw = Settings.llm.complete(prompt)
        text = raw.text if hasattr(raw, "text") else str(raw)

        text = text.strip()
        try:
            data = Settings.json_parser(text)  # type: ignore[attr-defined]
        except Exception:
            from json import loads

            try:
                data = loads(text)
            except Exception:
                data = {
                    "query_type": "general_qa",
                    "rewritten_query": user_query,
                }

        return ClassifiedQuery(**data)

    def _generate_answer(
        self,
        query_type: QueryType,
        original_query: str,
        rewritten_query: str,
        context: str,
    ) -> str:
        """
        Final prompt in the chain: turn retrieved context into a structured answer.
        """
        base_system = """
You are "ComplAInce", an AI assistant helping Canadian manufacturers
navigate provincial and federal regulations.

Rules:
- Ground EVERY statement in the supplied context.
- Always cite sources inline using [1], [2], etc., where the number refers
  to the context block index.
- If the context does not clearly support an answer to the user's question,
  you MUST NOT guess or generalize from outside knowledge.
- In that case, respond that the answer is not in the current corpus and
  suggest which regulations, documents, or authorities the user should consult.
"""

        if query_type == QueryType.PERMIT_GUIDANCE:
            task = """
Task: Provide a step-by-step guide to the relevant permit or application process.
- Organize the answer into numbered steps.
- Explicitly mention which forms, agencies, and deadlines apply where available.
- Highlight any prerequisites or eligibility conditions.
- End with a short recap paragraph.
"""
        elif query_type == QueryType.REG_IDENTIFICATION:
            task = """
Task: Identify which regulations, acts, or sections appear to apply.
- List each regulation/act as a bullet with a short explanation.
- Call out any jurisdictional nuance (federal vs provincial) when present.
- If the context seems incomplete, state this explicitly.
"""
        elif query_type == QueryType.CHECKLIST:
            task = """
Task: Produce a practical compliance checklist.
- Use bullet points with checkboxes: [ ] item description.
- Group related items under short headings if helpful.
- Only include items that are supported by the context.
"""
        else:  # GENERAL_QA
            task = """
Task: Answer the user's question as clearly as possible,
staying grounded in the context. Use short paragraphs and avoid unnecessary
legal jargon, but do not oversimplify regulatory requirements.
"""

        user_prompt = f"""
User's original question:
{original_query}

Rewritten query for retrieval:
{rewritten_query}

Relevant context chunks (with numbered citations):
{context}

Now write the final answer.
"""

        full_prompt = base_system + task + "\n\n" + user_prompt
        raw = Settings.llm.complete(full_prompt)
        return raw.text if hasattr(raw, "text") else str(raw)

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
                temperature=0.0,
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

    def _generate_permit_guidance_from_web(
        self,
        original_query: str,
        rewritten_query: str,
    ) -> str:
        """
        Fallback: generate step-by-step permit/form guidance using web search.

        This is used when the vector database has no relevant content for
        permit_guidance queries. It relies on OpenAI's web_search tool and
        is run with temperature=0 to avoid speculative answers. If suitable
        information cannot be found, it should clearly say so.
        """
        self.ensure_initialized()

        if not self._openai_client:
            return (
                "I attempted to look up detailed permit or form-filling instructions "
                "but could not access the web search service. Please refer directly "
                "to the official authority or the instructions that accompany the form."
            )

        prompt = f"""
You are "ComplAInce", an AI assistant helping Canadian manufacturers navigate
provincial and federal regulations.

The user is asking for help filling out a specific permit or regulatory form.
Your goals:
- Use the web_search tool to find official government pages, the form itself,
  and any official instructions or guides.
- Then produce a clear, step-by-step guide for filling out the form.
- For each step, briefly explain the underlying concept in plain language
  (for example: why a certain field is required, what typical values look like).
- If there are multiple jurisdictions or versions, clearly say which one you
  are describing.

Safety rules (VERY IMPORTANT):
- You must base your guidance on information you find via web_search or on
  obviously generic form-filling conventions.
- If you cannot find sufficiently detailed or trustworthy official information
  about this specific permit/form, you MUST say that you cannot safely guide
  them step-by-step and instead point them to the official authority or help desk.
- Do NOT fabricate specific regulatory requirements, deadlines, or numeric
  thresholds that are not clearly supported by search results.

User query:
{original_query}

Search-optimized version of the query:
{rewritten_query}
"""

        try:
            response = self._openai_client.responses.create(
                model=config.openai_model,
                tools=[{"type": "web_search"}],
                input=prompt,
                temperature=0.0,
            )

            # Extract the main text answer from the response
            for output in getattr(response, "output", []) or []:
                if getattr(output, "type", None) == "message":
                    parts: list[str] = []
                    for block in getattr(output, "content", []) or []:
                        text = getattr(block, "text", None)
                        if text:
                            parts.append(text)
                    if parts:
                        combined = "\n".join(parts).strip()
                        if combined:
                            return combined

        except Exception as e:
            print(f"Permit guidance web answer failed: {type(e).__name__}: {e}")

        return (
            "I tried to look up detailed permit or form-filling instructions on the web, "
            "but could not retrieve enough trustworthy information to safely guide you "
            "step-by-step. Please refer directly to the official authority, building "
            "department, or the instructions that accompany the form."
        )

    def query(self, query_text: str, top_k: int = 5) -> dict[str, Any]:
        """
        Query the RAG system using a prompt-chained flow.

        Flow:
        1) Classify and rewrite the user query for retrieval.
        2) Vectorize rewritten query → Qdrant search → retrieve nodes.
        3) Use a specialized prompt (based on query type) to generate answer.
        4) Run a web search for additional relevant documents/forms.
        """
        self.ensure_initialized()

        if self.index is None:
            raise HTTPException(
                status_code=400,
                detail="No documents indexed yet. Upload documents first.",
            )

        classified = self._classify_and_rewrite(query_text)

        # Minimum similarity score threshold - nodes below this are considered irrelevant
        SIMILARITY_THRESHOLD = 0.35

        query_engine = self.index.as_query_engine(
            similarity_top_k=top_k,
            response_mode="no_text",
        )

        retrieval_result = query_engine.query(classified.rewritten_query)
        raw_nodes = list(getattr(retrieval_result, "source_nodes", []) or [])

        # Filter nodes by similarity score - reject low-quality matches
        source_nodes = []
        for node in raw_nodes:
            score = getattr(node, "score", None)
            if score is not None and score >= SIMILARITY_THRESHOLD:
                source_nodes.append(node)

        # No relevant nodes after filtering - special-case permit guidance to fall back to web search
        if not source_nodes and classified.query_type == QueryType.PERMIT_GUIDANCE:
            web_results = self.search_web_for_documents(query_text)
            answer = self._generate_permit_guidance_from_web(
                original_query=query_text,
                rewritten_query=classified.rewritten_query,
            )
            return {
                "answer": answer,
                "sources": [],
                "nodes_retrieved": 0,
                "relevant_documents": web_results,
            }

        if not source_nodes:
            return {
                "answer": (
                    "I could not find relevant material in the current corpus to "
                    "reliably answer this question. You may need to ingest additional "
                    "regulations, guidance documents, or forms for this topic."
                ),
                "sources": [],
                "nodes_retrieved": 0,
                "relevant_documents": self.search_web_for_documents(query_text),
            }

        context_chunks: list[str] = []
        sources_set: set[str] = set()  # Deduplicate sources

        for idx, node in enumerate(source_nodes, start=1):
            metadata = node.metadata or {}
            source_name = metadata.get("file_name", "unknown")
            score = getattr(node, "score", 0)
            sources_set.add(source_name)
            context_chunks.append(
                f"[{idx}] Source: {source_name} (relevance: {score:.2f})\n{node.text.strip()}"
            )

        context_str = "\n\n".join(context_chunks)

        answer = self._generate_answer(
            query_type=classified.query_type,
            original_query=query_text,
            rewritten_query=classified.rewritten_query,
            context=context_str,
        )

        web_results = self.search_web_for_documents(query_text)

        return {
            "answer": answer,
            "sources": list(sources_set),
            "nodes_retrieved": len(source_nodes),
            "relevant_documents": web_results,
        }


# Global RAG system instance
